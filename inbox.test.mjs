import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Inbox } from './src/core/inbox.js';
import { AiBrain } from './src/core/ai-brain.js';
import { TenantRegistry } from './src/core/tenant-registry.js';
import { yeEducationConfig } from './src/configs/ye-education.config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'));

function makeBrain() {
  const brain = new AiBrain(yeEducationConfig);
  brain.inbox = new Inbox(tmp());
  brain.registerMerchant('shop_a', { businessName: 'A', systemPrompt: 'A' });
  brain.registerMerchant('shop_b', { businessName: 'B', systemPrompt: 'B' });
  brain.calls = 0;
  brain.engine.generateResponse = async () => { brain.calls++; return { text: 'Réponse IA' }; };
  return brain;
}

test('Chaque réseau arrive dans la même boîte, séparée par entreprise', async () => {
  const brain = makeBrain();
  await brain.processMessage('whatsapp:237690000001', 'Bonjour', 'whatsapp', { merchantSlug: 'shop_a', userName: 'Awa', delivery: { via: 'cloud', to: '237690000001' } });
  await brain.processMessage('messenger:555', 'Vous livrez ?', 'messenger', { merchantSlug: 'shop_a' });
  await brain.processMessage('telegram:9', 'Salut', 'telegram', { merchantSlug: 'shop_b' });
  const a = brain.inbox.list('shop_a');
  assert.equal(a.counts.all, 2);
  assert.deepEqual(a.conversations.map(c => c.platform).sort(), ['messenger', 'whatsapp']);
  assert.equal(brain.inbox.list('shop_b').counts.all, 1);
  const wa = a.conversations.find(c => c.platform === 'whatsapp');
  assert.equal(wa.name, 'Awa');
  assert.equal(wa.contact, '237690000001');
  const detail = brain.inbox.detail('shop_a', wa.id);
  assert.deepEqual(detail.messages.map(m => m.from), ['client', 'bot']);
  assert.equal(detail.delivery, undefined, 'les infos d’envoi ne sortent pas vers le navigateur');
  assert.equal(detail.sessionKey, undefined);
});

test('Reprise humaine : l’IA se tait, puis reprend avec le contexte', async () => {
  const brain = makeBrain();
  await brain.processMessage('web:u1', 'Bonjour', 'web', { merchantSlug: 'shop_a' });
  const id = Inbox.idFor('web', 'u1');
  brain.inbox.setStatus('shop_a', id, 'human', 'Paul');
  const before = brain.calls;
  const reply = await brain.processMessage('web:u1', 'Je peux payer demain ?', 'web', { merchantSlug: 'shop_a' });
  assert.equal(reply, null);
  assert.equal(brain.calls, before, 'aucun appel IA pendant la reprise');
  const conv = brain.inbox.get('shop_a', id);
  brain.inbox.recordOutgoing('shop_a', id, { from: 'agent', text: 'Oui, sans souci.', agent: 'Paul' });
  brain.recordAgentMessage(conv.sessionKey, 'Oui, sans souci.');
  brain.inbox.setStatus('shop_a', id, 'bot');
  let seen;
  brain.engine.generateResponse = async m => { seen = m; return { text: 'Parfait' }; };
  await brain.processMessage('web:u1', 'Merci', 'web', { merchantSlug: 'shop_a' });
  const history = JSON.stringify(seen);
  assert.match(history, /Je peux payer demain/);
  assert.match(history, /Oui, sans souci/);
});

test('Signalements, expiration de la reprise et réouverture', async () => {
  const brain = makeBrain();
  await brain.processMessage('web:u2', 'Arnaque, jamais reçu mon colis', 'web', { merchantSlug: 'shop_a' });
  const id = Inbox.idFor('web', 'u2');
  assert.equal(brain.inbox.get('shop_a', id).needsHuman, true);
  assert.equal(brain.inbox.list('shop_a', { filter: 'needs' }).conversations.length, 1);

  const conv = brain.inbox.get('shop_a', id);
  brain.inbox.setStatus('shop_a', id, 'human');
  conv.humanSince = Date.now() - 13 * 3600e3;
  assert.equal(brain.inbox.effectiveStatus(conv), 'bot', 'la main revient à l’IA après 12 h');

  brain.inbox.setStatus('shop_a', id, 'closed');
  await brain.processMessage('web:u2', 'Encore moi', 'web', { merchantSlug: 'shop_a' });
  assert.equal(brain.inbox.get('shop_a', id).status, 'bot');

  conv.platform = 'whatsapp';
  conv.lastClientAt = Date.now() - 25 * 3600e3;
  assert.equal(brain.inbox.canReplyFreely(conv), false, 'règle des 24 h');
});

test('HTTP : boîte de réception privée et réponse de l’équipe sur le chat web', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-http-'));
  const registry = new TenantRegistry(dir);
  const a = registry.create('client_a', { businessName: 'A', botName: 'Alice', credits_remaining: 20 });
  const b = registry.create('client_b', { businessName: 'B', botName: 'Bruno', credits_remaining: 20 });
  const child = spawn(process.execPath, ['src/server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: '3197', BOT_DATA_DIR: dir, ENABLE_WHATSAPP_WEB: 'false', DEEPSEEK_API_KEY: 'x', GEMINI_API_KEY: 'x' }, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 160; i++) { try { if ((await fetch('http://127.0.0.1:3197/health')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 150)); }
    assert(ready, 'serveur démarré');
    const call = (p, token, body) => fetch('http://127.0.0.1:3197' + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

    await call('/api/chat', a, { message: 'Bonjour', userId: 'v1', platform: 'web', userName: 'Visiteur' });
    const list = await (await call('/api/inbox?shop=client_a', a)).json();
    assert.equal(list.conversations.length, 1);
    const id = list.conversations[0].id;
    assert.equal((await call('/api/inbox?shop=client_a', b)).status, 403, 'B ne lit pas la boîte de A');

    const sent = await call('/api/inbox/reply', a, { id, text: 'Bonjour, ici Paul.', agent: 'Paul' });
    assert.equal(sent.status, 200);
    assert.equal((await sent.json()).conversation.status, 'human');

    const chat = await (await call('/api/chat', a, { message: 'Merci Paul', userId: 'v1', platform: 'web' })).json();
    assert.equal(chat.humanMode, true);
    const pending = await (await call('/api/chat/pending?platform=web&userId=v1', a)).json();
    assert.deepEqual(pending.messages.map(m => m.text), ['Bonjour, ici Paul.']);

    const back = await (await call('/api/inbox/status', a, { id, status: 'bot' })).json();
    assert.equal(back.conversation.status, 'bot');
    assert.equal((await call('/api/inbox/status', a, { id, status: 'pirate' })).status, 400);
  } finally { child.kill(); }
});
