/**
 * Boîte de réception unifiée : toutes les conversations d'une entreprise,
 * quel que soit le réseau (WhatsApp, Messenger, Instagram, Telegram, web…).
 *
 * Statuts d'une conversation :
 *  - bot    : l'assistant IA répond seul
 *  - human  : un membre de l'équipe a repris la main, l'IA se tait
 *  - closed : conversation traitée ; un nouveau message du client la rouvre en mode bot
 *
 * La reprise humaine expire d'elle-même après HUMAN_TIMEOUT sans réponse de l'équipe,
 * pour qu'aucun client ne reste sans réponse si le gérant oublie de rendre la main.
 *
 * Stockage : un fichier JSON par entreprise (pilote). À migrer vers Supabase.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const HUMAN_TIMEOUT = 12 * 60 * 60 * 1000;
const WINDOW_24H = 24 * 60 * 60 * 1000;
const MAX_MESSAGES = 300;
const MAX_CONVERSATIONS = 5000;

export class Inbox {
  constructor(dir, { humanTimeout = HUMAN_TIMEOUT } = {}) {
    this.dir = path.join(dir, 'inbox');
    this.humanTimeout = humanTimeout;
    fs.mkdirSync(this.dir, { recursive: true });
    this.cache = new Map(); // slug -> { conversations: {id: conv} }
    this.pending = new Map(); // conversations web : messages de l'équipe en attente de lecture
  }

  fileFor(slug) {
    const clean = String(slug || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!clean) throw Error('Entreprise invalide');
    return path.join(this.dir, clean + '.json');
  }

  load(slug) {
    if (this.cache.has(slug)) return this.cache.get(slug);
    const file = this.fileFor(slug);
    let data = { conversations: {} };
    if (fs.existsSync(file)) {
      try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.warn('[Inbox] Fichier illisible', file, e.message); }
    }
    this.cache.set(slug, data);
    return data;
  }

  save(slug) {
    const data = this.load(slug);
    const ids = Object.keys(data.conversations);
    if (ids.length > MAX_CONVERSATIONS) {
      ids.sort((a, b) => data.conversations[a].lastAt - data.conversations[b].lastAt)
        .slice(0, ids.length - MAX_CONVERSATIONS).forEach(id => delete data.conversations[id]);
    }
    const file = this.fileFor(slug);
    fs.writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }

  static idFor(platform, contact) {
    return createHash('sha256').update(platform + ':' + contact).digest('hex').slice(0, 20);
  }

  /** Statut réel, en tenant compte de l'expiration de la reprise humaine. */
  effectiveStatus(conv, now = Date.now()) {
    if (conv.status === 'human' && now - (conv.humanSince || 0) > this.humanTimeout && now - (conv.lastAgentAt || 0) > this.humanTimeout) return 'bot';
    return conv.status;
  }

  recordIncoming(slug, { platform, contact, name, text, sessionKey, delivery, at = Date.now() }) {
    const data = this.load(slug);
    const id = Inbox.idFor(platform, contact);
    let conv = data.conversations[id];
    if (!conv) {
      conv = data.conversations[id] = {
        id, platform, contact: String(contact), name: name || 'Client', status: 'bot',
        createdAt: at, lastAt: at, unread: 0, needsHuman: false, tags: [], note: '', messages: []
      };
    }
    if (name && name !== 'Client') conv.name = name;
    if (delivery) conv.delivery = delivery;
    if (sessionKey) conv.sessionKey = sessionKey;
    const status = this.effectiveStatus(conv, at);
    if (status !== conv.status) { conv.status = status; this.pushSystem(conv, 'La main est rendue automatiquement à l’assistant (aucune réponse de l’équipe depuis 12 h).', at); }
    if (conv.status === 'closed') { conv.status = 'bot'; this.pushSystem(conv, 'Conversation rouverte par un nouveau message du client.', at); }
    conv.messages.push({ from: 'client', text: String(text).slice(0, 4000), at });
    conv.lastAt = conv.lastClientAt = at;
    conv.unread++;
    this.trim(conv);
    this.save(slug);
    return conv;
  }

  recordOutgoing(slug, id, { from, text, agent, delivered = true, at = Date.now() }) {
    const conv = this.get(slug, id);
    if (!conv) return null;
    conv.messages.push({ from, text: String(text).slice(0, 4000), at, ...(agent ? { agent } : {}), ...(delivered ? {} : { delivered: false }) });
    conv.lastAt = at;
    if (from === 'agent') { conv.lastAgentAt = at; conv.unread = 0; conv.needsHuman = false; }
    this.trim(conv);
    this.save(slug);
    return conv;
  }

  pushSystem(conv, text, at = Date.now()) {
    conv.messages.push({ from: 'system', text, at });
  }

  trim(conv) {
    if (conv.messages.length > MAX_MESSAGES) conv.messages.splice(0, conv.messages.length - MAX_MESSAGES);
  }

  get(slug, id) {
    return this.load(slug).conversations[id] || null;
  }

  isHumanActive(slug, id) {
    const conv = this.get(slug, id);
    return !!conv && this.effectiveStatus(conv) === 'human';
  }

  flag(slug, id, reason) {
    const conv = this.get(slug, id);
    if (!conv || conv.needsHuman) return;
    conv.needsHuman = true;
    conv.needsHumanReason = reason;
    this.save(slug);
  }

  setStatus(slug, id, status, agent) {
    if (!['bot', 'human', 'closed'].includes(status)) throw Error('Statut invalide');
    const conv = this.get(slug, id);
    if (!conv) return null;
    if (conv.status === status) return conv;
    conv.status = status;
    if (status === 'human') { conv.humanSince = Date.now(); this.pushSystem(conv, `${agent || 'L’équipe'} a repris la conversation. L’assistant est en pause.`); }
    if (status === 'bot') this.pushSystem(conv, 'La main est rendue à l’assistant IA.');
    if (status === 'closed') { conv.needsHuman = false; conv.unread = 0; this.pushSystem(conv, 'Conversation marquée comme traitée.'); }
    this.save(slug);
    return conv;
  }

  update(slug, id, { note, tags }) {
    const conv = this.get(slug, id);
    if (!conv) return null;
    if (typeof note === 'string') conv.note = note.slice(0, 2000);
    if (Array.isArray(tags)) conv.tags = [...new Set(tags.map(t => String(t).trim().slice(0, 30)).filter(Boolean))].slice(0, 10);
    this.save(slug);
    return conv;
  }

  markRead(slug, id) {
    const conv = this.get(slug, id);
    if (conv && conv.unread) { conv.unread = 0; this.save(slug); }
    return conv;
  }

  /** WhatsApp n'autorise un message libre que dans les 24 h suivant le dernier message du client. */
  canReplyFreely(conv, now = Date.now()) {
    if (conv.platform !== 'whatsapp' && conv.platform !== 'messenger' && conv.platform !== 'instagram') return true;
    return now - (conv.lastClientAt || 0) < WINDOW_24H;
  }

  summary(conv) {
    const last = [...conv.messages].reverse().find(m => m.from !== 'system');
    return {
      id: conv.id, platform: conv.platform, name: conv.name,
      contact: conv.platform === 'whatsapp' ? conv.contact : undefined,
      status: this.effectiveStatus(conv), unread: conv.unread, needsHuman: conv.needsHuman,
      needsHumanReason: conv.needsHumanReason, tags: conv.tags, lastAt: conv.lastAt,
      preview: last ? { from: last.from, text: last.text.slice(0, 120) } : null
    };
  }

  list(slug, { filter = 'all', q = '', platform = '' } = {}) {
    const all = Object.values(this.load(slug).conversations).map(c => this.summary(c));
    const counts = {
      all: all.filter(c => c.status !== 'closed').length,
      needs: all.filter(c => c.needsHuman && c.status !== 'closed').length,
      human: all.filter(c => c.status === 'human').length,
      unread: all.filter(c => c.unread > 0).length,
      closed: all.filter(c => c.status === 'closed').length
    };
    const query = q.toLowerCase().trim();
    const rows = all.filter(c =>
      (filter === 'all' ? c.status !== 'closed'
        : filter === 'needs' ? c.needsHuman && c.status !== 'closed'
        : filter === 'unread' ? c.unread > 0
        : c.status === filter) &&
      (!platform || c.platform === platform) &&
      (!query || (c.name + ' ' + (c.contact || '') + ' ' + (c.preview?.text || '') + ' ' + c.tags.join(' ')).toLowerCase().includes(query))
    ).sort((a, b) => (b.needsHuman - a.needsHuman) || (b.lastAt - a.lastAt));
    return { counts, conversations: rows.slice(0, 200) };
  }

  detail(slug, id) {
    const conv = this.get(slug, id);
    if (!conv) return null;
    const { delivery, sessionKey, ...safe } = conv;
    return { ...safe, status: this.effectiveStatus(conv), canReplyFreely: this.canReplyFreely(conv), contact: conv.platform === 'whatsapp' ? conv.contact : undefined };
  }

  // File d'attente du chat web : le widget vient chercher les réponses de l'équipe.
  queueWeb(slug, id, text) {
    const key = slug + '|' + id, list = this.pending.get(key) || [];
    list.push({ text, at: Date.now() });
    this.pending.set(key, list.slice(-50));
  }

  takeWeb(slug, id) {
    const key = slug + '|' + id, list = this.pending.get(key) || [];
    this.pending.delete(key);
    return list;
  }
}
