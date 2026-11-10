import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Analytics, classifyIntent, detectSentiment } from './src/core/analytics.js';
import { AiBrain } from './src/core/ai-brain.js';
import { yeEducationConfig } from './src/configs/ye-education.config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-'));
const DAY = 86400000;

test('Classification des intentions et de l’humeur', () => {
  assert.equal(classifyIntent('C’est combien la robe rouge ?'), 'prix');
  assert.equal(classifyIntent('Je veux commander 2 paires'), 'commande');
  assert.equal(classifyIntent('Vous livrez à Bastos ?'), 'livraison');
  assert.equal(classifyIntent('Bonjour'), 'salutation');
  assert.equal(classifyIntent('jamais reçu mon colis, arnaque'), 'reclamation');
  assert.equal(classifyIntent('Parlez-moi de vous'), 'autre');
  assert.equal(detectSentiment('Merci beaucoup, parfait'), 'positif');
  assert.equal(detectSentiment('Service nul'), 'negatif');
});

test('Agrégation, contacts anonymisés, lacunes et comparaison de période', () => {
  const a = new Analytics(tmp()), now = Date.now();
  a.record('shop', { contact: 'whatsapp:237690000001', platform: 'whatsapp', message: 'Combien la robe ?', reply: 'Elle coûte 5000 FCFA.', at: now - 2 * DAY, latencyMs: 900 });
  a.record('shop', { contact: 'whatsapp:237690000001', platform: 'whatsapp', message: 'Je veux commander, mon numéro 690 00 00 01', reply: 'Noté !', at: now - DAY, latencyMs: 1100 });
  a.record('shop', { contact: 'messenger:42', platform: 'messenger', message: 'Vous ouvrez le dimanche ?', reply: 'Je ne dispose pas de cette information, je vais transmettre au gérant.', at: now - DAY });
  a.record('shop', { contact: 'messenger:7', platform: 'messenger', message: 'Bonjour', reply: 'Bonjour !', at: now - 40 * DAY });
  const s = a.summary('shop', { days: 30, now });
  assert.equal(s.kpis.messages, 3);
  assert.equal(s.kpis.contacts, 2);
  assert.equal(s.kpis.newContacts, 2);
  assert.equal(s.kpis.purchaseIntents, 1);
  assert.equal(s.kpis.leads, 1);
  assert.equal(s.knowledgeGaps.length, 1);
  assert.equal(s.previous.messages, 1);
  assert.equal(s.daily.length, 30);
  assert.equal(s.daily.reduce((n, d) => n + d.messages, 0), 3);
  assert.equal(s.platforms[0].key, 'whatsapp');
  assert(s.insights.some(i => i.level === 'action'));
  const raw = fs.readFileSync(a.fileFor('shop'), 'utf8');
  assert(!raw.includes('whatsapp:237690000001'), 'le contact doit être haché');
  assert.match(a.toCsv('shop', { days: 30, now }), /intention;sentiment/);
});

test('Le moteur IA alimente l’analyse sans mélanger les entreprises', async () => {
  const brain = new AiBrain(yeEducationConfig);
  brain.analytics = new Analytics(tmp());
  brain.registerMerchant('client_a', { businessName: 'A', systemPrompt: 'A' });
  brain.registerMerchant('client_b', { businessName: 'B', systemPrompt: 'B', credits_remaining: 0 });
  brain.engine.generateResponse = async () => ({ text: 'Réponse' });
  await brain.processMessage('u1', 'Quel prix ?', 'web', { merchantSlug: 'client_a' });
  await brain.processMessage('u1', 'Quel prix ?', 'web', { merchantSlug: 'client_b' });
  assert.equal(brain.analytics.read('client_a').length, 1);
  assert.equal(brain.analytics.read('client_a')[0].o, 'answered');
  assert.equal(brain.analytics.read('client_b')[0].o, 'no_credit');
});

test('Un slug malveillant ne sort pas du dossier d’analyse', () => {
  const a = new Analytics(tmp());
  assert(a.fileFor('../../etc/passwd').startsWith(a.dir));
  assert.throws(() => a.fileFor('../..'));
});
