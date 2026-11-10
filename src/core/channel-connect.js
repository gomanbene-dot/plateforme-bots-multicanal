/**
 * Connexion des réseaux « en un clic », sans aucune clé à saisir par le client.
 *
 * Meta (Messenger, Instagram, WhatsApp) : le client se connecte avec Facebook,
 * choisit sa page ou son numéro, et Meta renvoie une autorisation à notre serveur
 * (flux OAuth « Facebook Login for Business »). Pour WhatsApp, si un identifiant de
 * configuration est fourni (META_WHATSAPP_CONFIG_ID), la fenêtre officielle
 * « Embedded Signup » de Meta guide aussi la création du compte WhatsApp Business.
 *
 * Telegram : le client colle le code donné par @BotFather ; le serveur vérifie le bot
 * et configure lui-même la réception des messages.
 *
 * Variables nécessaires côté plateforme (une seule fois, par vous) :
 *   PUBLIC_URL, META_APP_ID, META_APP_SECRET, [META_WHATSAPP_CONFIG_ID], [META_LOGIN_CONFIG_ID]
 */

import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const SCOPES = {
  messenger: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'business_management'],
  instagram: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'business_management', 'instagram_basic', 'instagram_manage_messages'],
  whatsapp: ['business_management', 'whatsapp_business_management', 'whatsapp_business_messaging']
};
const STATE_TTL = 15 * 60 * 1000;
const b64url = b => Buffer.from(b).toString('base64url');

export class ChannelConnector {
  constructor({ vault, fetch = globalThis.fetch, env = process.env } = {}) {
    this.vault = vault;
    this.fetch = fetch;
    this.env = env;
    this.pending = new Map(); // choix de page / numéro en attente, gardé 15 min en mémoire
  }

  get publicUrl() { return String(this.env.PUBLIC_URL || '').replace(/\/+$/, ''); }
  get graph() { return `https://graph.facebook.com/${this.env.META_GRAPH_VERSION || 'v23.0'}`; }
  get redirectUri() { return this.publicUrl + '/oauth/meta/callback'; }

  status() {
    const meta = !!(this.env.META_APP_ID && this.env.META_APP_SECRET && /^https:\/\//.test(this.publicUrl));
    return { meta, telegram: /^https:\/\//.test(this.publicUrl) };
  }

  // ---------- État signé : empêche qu'un lien de connexion soit détourné vers une autre entreprise ----------
  signState(payload) {
    const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + STATE_TTL, n: randomBytes(8).toString('hex') }));
    const sig = createHmac('sha256', this.vault.key).update(body).digest('base64url');
    return body + '.' + sig;
  }

  verifyState(state) {
    const [body, sig] = String(state || '').split('.');
    if (!body || !sig) throw Error('Lien de connexion invalide');
    const expected = createHmac('sha256', this.vault.key).update(body).digest('base64url');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw Error('Lien de connexion invalide');
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (data.exp < Date.now()) throw Error('Le lien de connexion a expiré, recommencez.');
    return data;
  }

  // ---------- Meta ----------
  metaLoginUrl(shop, platform) {
    if (!SCOPES[platform]) throw Error('Réseau inconnu');
    if (!this.status().meta) throw Error('La connexion Meta n’est pas encore configurée sur la plateforme');
    const p = new URLSearchParams({
      client_id: this.env.META_APP_ID,
      redirect_uri: this.redirectUri,
      state: this.signState({ shop, platform }),
      response_type: 'code'
    });
    const configId = platform === 'whatsapp' ? this.env.META_WHATSAPP_CONFIG_ID : this.env.META_LOGIN_CONFIG_ID;
    if (configId) {
      p.set('config_id', configId);
      p.set('override_default_response_type', 'true');
      if (platform === 'whatsapp') p.set('extras', JSON.stringify({ setup: {}, featureType: '', sessionInfoVersion: '3' }));
    } else {
      p.set('scope', SCOPES[platform].join(','));
    }
    return `https://www.facebook.com/${this.env.META_GRAPH_VERSION || 'v23.0'}/dialog/oauth?${p}`;
  }

  async graphCall(path, { method = 'GET', params = {}, token } = {}) {
    const url = new URL(this.graph + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (token) url.searchParams.set('access_token', token);
    const res = await this.fetch(url, { method, signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const msg = data.error?.message || 'Réponse inattendue de Meta';
      console.warn('[Meta]', path, msg);
      throw Error('Meta a refusé la demande : ' + msg);
    }
    return data;
  }

  async exchangeCode(code) {
    const short = await this.graphCall('/oauth/access_token', { params: {
      client_id: this.env.META_APP_ID, client_secret: this.env.META_APP_SECRET, redirect_uri: this.redirectUri, code
    } });
    // Jeton longue durée : les jetons de page qui en dérivent n'expirent pas
    const long = await this.graphCall('/oauth/access_token', { params: {
      grant_type: 'fb_exchange_token', client_id: this.env.META_APP_ID, client_secret: this.env.META_APP_SECRET, fb_exchange_token: short.access_token
    } }).catch(() => short);
    return long.access_token;
  }

  async listAccounts(platform, userToken) {
    if (platform === 'messenger' || platform === 'instagram') {
      const pages = (await this.graphCall('/me/accounts', { token: userToken, params: { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100' } })).data || [];
      if (platform === 'messenger') return pages.map(p => ({ routeId: p.id, sendId: p.id, name: p.name, token: p.access_token }));
      return pages.filter(p => p.instagram_business_account).map(p => ({
        routeId: p.instagram_business_account.id, sendId: p.id,
        name: '@' + (p.instagram_business_account.username || p.instagram_business_account.id) + ' · ' + p.name, token: p.access_token
      }));
    }
    // WhatsApp : les comptes WhatsApp Business autorisés figurent dans les droits accordés au jeton
    const debug = await this.graphCall('/debug_token', { params: { input_token: userToken, access_token: this.env.META_APP_ID + '|' + this.env.META_APP_SECRET } });
    const wabaIds = [...new Set((debug.data?.granular_scopes || []).filter(s => s.scope === 'whatsapp_business_management').flatMap(s => s.target_ids || []))];
    const accounts = [];
    for (const waba of wabaIds) {
      const phones = (await this.graphCall(`/${waba}/phone_numbers`, { token: userToken, params: { fields: 'id,display_phone_number,verified_name' } })).data || [];
      for (const ph of phones) accounts.push({ routeId: ph.id, sendId: ph.id, name: `${ph.verified_name || 'WhatsApp'} · ${ph.display_phone_number || ''}`.trim(), token: userToken, extra: { wabaId: waba, phone: ph.display_phone_number } });
    }
    return accounts;
  }

  /** Abonne le compte aux messages : sans cela, Meta n'envoie rien à notre serveur. */
  async activate(platform, account) {
    if (platform === 'whatsapp') await this.graphCall(`/${account.extra.wabaId}/subscribed_apps`, { method: 'POST', token: account.token });
    else await this.graphCall(`/${account.sendId}/subscribed_apps`, { method: 'POST', token: account.token, params: { subscribed_fields: 'messages,messaging_postbacks' } });
  }

  async finish(shop, platform, account) {
    await this.activate(platform, account);
    return this.vault.connect({ merchantSlug: shop, platform, routeId: account.routeId, sendId: account.sendId, name: account.name, token: account.token, extra: account.extra || {} });
  }

  /**
   * Retour de Facebook. Une seule page/numéro : connexion directe.
   * Plusieurs : on garde le choix en attente et le client choisit dans son espace.
   */
  async handleCallback({ code, state, error }) {
    const { shop, platform } = this.verifyState(state);
    if (error || !code) return { shop, platform, cancelled: true };
    const token = await this.exchangeCode(code);
    const accounts = await this.listAccounts(platform, token);
    if (!accounts.length) {
      const what = platform === 'instagram' ? 'aucun compte Instagram professionnel relié à une page Facebook' : platform === 'whatsapp' ? 'aucun numéro WhatsApp Business' : 'aucune page Facebook';
      throw Error(`Connexion réussie, mais ${what} n’a été autorisé. Recommencez en cochant le compte voulu.`);
    }
    if (accounts.length === 1) return { shop, platform, connected: await this.finish(shop, platform, accounts[0]) };
    const pendingId = randomBytes(12).toString('hex');
    this.pending.set(pendingId, { shop, platform, accounts, exp: Date.now() + STATE_TTL });
    return { shop, platform, pendingId };
  }

  pendingChoices(shop, pendingId) {
    const p = this.pending.get(pendingId);
    if (!p || p.shop !== shop || p.exp < Date.now()) return null;
    return { platform: p.platform, accounts: p.accounts.map(a => ({ routeId: a.routeId, name: a.name })) };
  }

  async choose(shop, pendingId, routeId) {
    const p = this.pending.get(pendingId);
    if (!p || p.shop !== shop || p.exp < Date.now()) throw Error('Ce choix a expiré, relancez la connexion.');
    const account = p.accounts.find(a => a.routeId === String(routeId));
    if (!account) throw Error('Compte introuvable');
    const view = await this.finish(shop, p.platform, account);
    this.pending.delete(pendingId);
    return view;
  }

  // ---------- Telegram ----------
  async connectTelegram(shop, botToken) {
    botToken = String(botToken || '').trim();
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(botToken)) throw Error('Code invalide : copiez le code complet donné par @BotFather (il ressemble à 123456789:AA…).');
    if (!this.status().telegram) throw Error('L’adresse publique de la plateforme (PUBLIC_URL) n’est pas configurée');
    const call = async (method, body) => {
      const res = await this.fetch(`https://api.telegram.org/bot${botToken}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw Error(method === 'getMe' ? 'Telegram ne reconnaît pas ce code. Vérifiez-le dans @BotFather.' : 'Telegram a refusé la configuration : ' + (data.description || 'erreur'));
      return data.result;
    };
    const me = await call('getMe');
    const secret = randomBytes(24).toString('hex');
    await call('setWebhook', { url: `${this.publicUrl}/webhook/telegram/${me.id}`, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true });
    return this.vault.connect({ merchantSlug: shop, platform: 'telegram', routeId: String(me.id), name: '@' + me.username, token: botToken, secret, extra: { username: me.username } });
  }

  // ---------- Déconnexion ----------
  async disconnect(shop, platform, routeId) {
    const ch = this.vault.disconnect(shop, platform, routeId);
    if (!ch) return false;
    try {
      if (platform === 'telegram') await this.fetch(`https://api.telegram.org/bot${ch.token}/deleteWebhook`, { method: 'POST' });
      else if (platform !== 'whatsapp') await this.graphCall(`/${ch.sendId}/subscribed_apps`, { method: 'DELETE', token: ch.token });
    } catch (e) { console.warn('[Déconnexion]', e.message); }
    return true;
  }
}
