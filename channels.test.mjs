import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ChannelVault } from './src/core/channel-vault.js';
import { ChannelConnector } from './src/core/channel-connect.js';
import { TenantRegistry } from './src/core/tenant-registry.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
const ENV = { PUBLIC_URL: 'https://bots.example.com', META_APP_ID: '111', META_APP_SECRET: 'appsecret' };

/** Faux serveur Meta / Telegram : enregistre les appels et renvoie des réponses prévues. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (input, opts = {}) => {
    const url = new URL(String(input));
    calls.push({ method: opts.method || 'GET', url, body: opts.body ? JSON.parse(opts.body) : null });
    const key = Object.keys(routes).find(k => { const [m, p] = k.split(' '); return m === (opts.method || 'GET') && url.pathname.endsWith(p); });
    const body = key ? (typeof routes[key] === 'function' ? routes[key](url) : routes[key]) : { error: { message: 'route non prévue ' + url.pathname } };
    return { ok: !body.error, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('Coffre : jetons chiffrés, propriétaire unique, mauvaise clé refusée', () => {
  const dir = tmp();
  const v = new ChannelVault(dir);
  v.connect({ merchantSlug: 'a', platform: 'messenger', routeId: 'page1', name: 'Page A', token: 'EAA-secret-token' });
  assert(!fs.readFileSync(v.file, 'utf8').includes('EAA-secret-token'), 'le jeton ne doit pas être lisible sur le disque');
  assert.equal(new ChannelVault(dir).resolve('messenger', 'page1').token, 'EAA-secret-token');
  assert.throws(() => v.connect({ merchantSlug: 'b', platform: 'messenger', routeId: 'page1', token: 'x' }), /autre entreprise/);
  assert.equal(v.disconnect('b', 'messenger', 'page1'), null, 'B ne peut pas déconnecter la page de A');
  assert.deepEqual(v.listFor('b'), []);
  assert.equal(v.listFor('a')[0].token, undefined, 'la liste publique ne contient pas le jeton');
  const other = new ChannelVault(dir, { key: 'ab'.repeat(32) });
  assert.equal(other.resolve('messenger', 'page1'), null);
  v.connect({ merchantSlug: 'a', platform: 'telegram', routeId: '42', token: '1:x', secret: 's3cret' });
  assert(v.checkSecret('telegram', '42', 's3cret'));
  assert.equal(v.checkSecret('telegram', '42', 'faux'), null);
});

test('Lien de connexion signé : falsification et expiration refusées', () => {
  const c = new ChannelConnector({ vault: new ChannelVault(tmp()), env: ENV });
  const s = c.signState({ shop: 'a', platform: 'messenger' });
  assert.equal(c.verifyState(s).shop, 'a');
  const [body, sig] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), shop: 'b' })).toString('base64url') + '.' + sig;
  assert.throws(() => c.verifyState(forged), /invalide/);
  const url = new URL(c.metaLoginUrl('a', 'instagram'));
  assert.equal(url.searchParams.get('redirect_uri'), 'https://bots.example.com/oauth/meta/callback');
  assert.match(url.searchParams.get('scope'), /instagram_manage_messages/);
  const wa = new URL(new ChannelConnector({ vault: c.vault, env: { ...ENV, META_WHATSAPP_CONFIG_ID: 'cfg9' } }).metaLoginUrl('a', 'whatsapp'));
  assert.equal(wa.searchParams.get('config_id'), 'cfg9');
  assert.throws(() => new ChannelConnector({ vault: c.vault, env: {} }).metaLoginUrl('a', 'messenger'), /pas encore configurée/);
});

const tokenRoutes = { 'GET /oauth/access_token': u => ({ access_token: u.searchParams.get('code') ? 'short' : 'long-user' }) };

test('Messenger : une page = connexion directe et abonnement automatique', async () => {
  const fetch = fakeFetch({ ...tokenRoutes,
    'GET /me/accounts': { data: [{ id: 'P1', name: 'Boutique A', access_token: 'PAGE-TOKEN' }] },
    'POST /P1/subscribed_apps': { success: true } });
  const c = new ChannelConnector({ vault: new ChannelVault(tmp()), env: ENV, fetch });
  const r = await c.handleCallback({ code: 'abc', state: c.signState({ shop: 'a', platform: 'messenger' }) });
  assert.equal(r.connected.name, 'Boutique A');
  assert.equal(c.vault.resolve('messenger', 'P1').token, 'PAGE-TOKEN');
  assert(fetch.calls.some(x => x.method === 'POST' && x.url.pathname.endsWith('/P1/subscribed_apps')));
});

test('Instagram : plusieurs comptes = choix, puis envoi via la page', async () => {
  const fetch = fakeFetch({ ...tokenRoutes,
    'GET /me/accounts': { data: [
      { id: 'P1', name: 'Page 1', access_token: 'T1', instagram_business_account: { id: 'IG1', username: 'boutique1' } },
      { id: 'P2', name: 'Page 2', access_token: 'T2', instagram_business_account: { id: 'IG2', username: 'boutique2' } },
      { id: 'P3', name: 'Sans Instagram', access_token: 'T3' }] },
    'POST /P2/subscribed_apps': { success: true } });
  const c = new ChannelConnector({ vault: new ChannelVault(tmp()), env: ENV, fetch });
  const r = await c.handleCallback({ code: 'abc', state: c.signState({ shop: 'a', platform: 'instagram' }) });
  assert(r.pendingId);
  assert.equal(c.pendingChoices('b', r.pendingId), null, 'une autre entreprise ne voit pas le choix');
  assert.deepEqual(c.pendingChoices('a', r.pendingId).accounts.map(x => x.routeId), ['IG1', 'IG2']);
  await c.choose('a', r.pendingId, 'IG2');
  const ch = c.vault.resolve('instagram', 'IG2');
  assert.equal(ch.sendId, 'P2');
  assert.equal(ch.token, 'T2');
});

test('WhatsApp : numéros trouvés dans les droits accordés', async () => {
  const fetch = fakeFetch({ ...tokenRoutes,
    'GET /debug_token': { data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['W1'] }] } },
    'GET /W1/phone_numbers': { data: [{ id: 'PH1', display_phone_number: '+237 6 77 00 00 00', verified_name: 'Boutique A' }] },
    'POST /W1/subscribed_apps': { success: true } });
  const c = new ChannelConnector({ vault: new ChannelVault(tmp()), env: ENV, fetch });
  const r = await c.handleCallback({ code: 'abc', state: c.signState({ shop: 'a', platform: 'whatsapp' }) });
  assert.match(r.connected.name, /Boutique A/);
  assert.equal(c.vault.resolve('whatsapp', 'PH1').extra.wabaId, 'W1');
});

test('Telegram : code vérifié, webhook avec secret, code invalide refusé', async () => {
  const fetch = fakeFetch({ 'POST /getMe': { ok: true, result: { id: 987654, username: 'boutique_a_bot' } }, 'POST /setWebhook': { ok: true, result: true } });
  const c = new ChannelConnector({ vault: new ChannelVault(tmp()), env: ENV, fetch });
  await assert.rejects(c.connectTelegram('a', 'pas-un-code'), /Code invalide/);
  const view = await c.connectTelegram('a', '987654:AAH' + 'x'.repeat(32));
  assert.equal(view.name, '@boutique_a_bot');
  const hook = fetch.calls.find(x => x.url.pathname.endsWith('/setWebhook')).body;
  assert.equal(hook.url, 'https://bots.example.com/webhook/telegram/987654');
  assert(c.vault.checkSecret('telegram', '987654', hook.secret_token));
});

test('HTTP : réseaux par entreprise, webhook Telegram protégé, lien signé', async () => {
  const dir = tmp();
  const registry = new TenantRegistry(dir);
  const a = registry.create('client_a', { businessName: 'A', credits_remaining: 20 });
  const b = registry.create('client_b', { businessName: 'B', credits_remaining: 20 });
  new ChannelVault(dir).connect({ merchantSlug: 'client_a', platform: 'telegram', routeId: '555', name: '@a_bot', token: '555:x', secret: 'bon-secret' });
  const child = spawn(process.execPath, ['src/server.js'], { cwd: process.cwd(), env: { ...process.env, ...ENV, PORT: '3196', BOT_DATA_DIR: dir, ENABLE_WHATSAPP_WEB: 'false', DEEPSEEK_API_KEY: 'x', GEMINI_API_KEY: 'x' }, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 160; i++) { try { if ((await fetch('http://127.0.0.1:3196/health')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 150)); }
    assert(ready, 'serveur démarré');
    const call = (p, token, body) => fetch('http://127.0.0.1:3196' + p, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

    const ca = await (await call('/api/channels?shop=client_a', a)).json();
    assert.equal(ca.channels.telegram.accounts[0].name, '@a_bot');
    assert.equal(ca.ready.meta, true);
    const cb = await (await call('/api/channels?shop=client_b', b)).json();
    assert.equal(cb.channels.telegram.accounts.length, 0);

    const hook = (secret) => fetch('http://127.0.0.1:3196/webhook/telegram/555', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: '{}' });
    assert.equal((await hook('faux')).status, 403);
    assert.equal((await hook('bon-secret')).status, 200);

    const start = await (await call('/api/channels/meta/start', a, { platform: 'messenger' })).json();
    assert.match(start.url, /^https:\/\/www\.facebook\.com\//);
    assert.equal((await call('/api/channels/meta/start', b, { shop: 'client_a', platform: 'messenger' })).status, 403);

    const bad = await fetch('http://127.0.0.1:3196/oauth/meta/callback?code=x&state=falsifie.abc', { redirect: 'manual' });
    assert.equal(bad.status, 302);
    assert.match(bad.headers.get('location'), /error=/);
  } finally { child.kill(); }
});
