/**
 * Analyse des conversations par entreprise.
 * Chaque échange (message client + réponse du bot) devient un événement léger,
 * stocké en JSONL par entreprise. Aucun appel IA : la classification est locale
 * et gratuite, pour ne pas consommer de crédits.
 * Les identifiants clients sont hachés : le tableau de bord compte des contacts
 * sans exposer leurs numéros.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const DAY = 24 * 60 * 60 * 1000;
const localKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// Intentions détectées par mots-clés (français, anglais, pidgin camerounais courant)
const INTENTS = [
  ['reclamation', /\b(plainte|arnaque|rembours|pas re[çc]u|jamais re[çc]u|probl[eè]me|d[ée][çc]u|nul|escroc|retard|complain|scam|refund)/i],
  ['commande', /\b(command|acheter|ach[eè]te|je prends|je veux|r[ée]serv|panier|order|buy|i want|i go take)/i],
  ['prix', /\b(prix|co[uû]t|combien|tarif|cher|fcfa|frs|francs|r[ée]duc|promo|price|how much|hau much)/i],
  ['paiement', /\b(pay|paie|momo|mobile money|orange money|om\b|virement|carte)/i],
  ['livraison', /\b(livr|exp[ée]di|d[ée]lai|colis|recevoir|deliver|shipping)/i],
  ['disponibilite', /\b(dispo|stock|taille|pointure|couleur|reste|encore|available|size)/i],
  ['localisation', /\b(o[uù] (vous|[êe]tes|se trouve)|adresse|situ[ée]|quartier|localis|horaire|ouvert|ferm[ée]|where|location|open)/i],
  ['installation', /\b(install|t[ée]l[ée]charg|application|appli|apk|lien|download)/i],
  ['compte', /\b(compte|connexion|connecter|mot de passe|inscri|e-?mail|login|account)/i],
  ['salutation', /^(bonjour|bonsoir|salut|hello|hi|coucou|cc|slt|bjr|bsr|good (morning|evening)|how far)\b[\s!.,?]*$/i]
];

const NEGATIVE = /\b(nul|arnaque|escroc|d[ée][çc]u|f[âa]ch[ée]|honte|pas content|mauvais|lent|jamais|probl[eè]me|scam|bad|angry)/i;
const POSITIVE = /\b(merci|super|parfait|g[ée]nial|top|excellent|bravo|content|satisfait|cool|thanks|thank you|great)/i;
const PHONE = /(?:\+?237[\s.-]?)?\b6[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}\b|\+\d{9,14}/;
// Réponse du bot qui renvoie vers un humain ou avoue ne pas savoir : lacune de connaissance
const ESCALATION = /(je ne (sais|dispose|connais|peux pas confirmer)|pas (cette|d['e] ?)information|transmettre|g[ée]rant|contact(ez|er) (directement|le support)|support humain|momentan[ée]ment indisponible|temporairement indisponible)/i;

export const INTENT_LABELS = {
  commande: 'Intention d’achat', prix: 'Prix et promotions', paiement: 'Paiement',
  livraison: 'Livraison', disponibilite: 'Disponibilité / stock', localisation: 'Adresse et horaires',
  installation: 'Installation', compte: 'Compte', reclamation: 'Réclamation',
  salutation: 'Salutation', autre: 'Autre question'
};

export const isEscalation = reply => ESCALATION.test(reply || '');

export function classifyIntent(text = '') {
  for (const [intent, re] of INTENTS) if (re.test(text)) return intent;
  return 'autre';
}

export function detectSentiment(text = '') {
  if (NEGATIVE.test(text)) return 'negatif';
  if (POSITIVE.test(text)) return 'positif';
  return 'neutre';
}

function normalizeQuestion(text) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(PHONE, '#tel').replace(/[^a-z0-9#\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export class Analytics {
  constructor(dir) {
    this.dir = path.join(dir, 'analytics');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  fileFor(slug) {
    const clean = String(slug || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!clean) throw Error('Entreprise invalide');
    return path.join(this.dir, clean + '.jsonl');
  }

  /**
   * Enregistre un échange. outcome : answered | escalated | error | no_credit
   */
  record(slug, { contact, platform, message, reply, outcome, latencyMs = 0, at = Date.now() }) {
    const text = String(message || '');
    if (!outcome) outcome = ESCALATION.test(reply || '') ? 'escalated' : 'answered';
    const event = {
      t: at,
      p: platform || 'web',
      c: createHash('sha256').update(String(contact || 'anonyme')).digest('hex').slice(0, 16),
      i: classifyIntent(text),
      s: detectSentiment(text),
      o: outcome,
      l: Math.max(0, Math.round(latencyMs)),
      lead: PHONE.test(text) || undefined,
      q: text.slice(0, 160)
    };
    fs.appendFileSync(this.fileFor(slug), JSON.stringify(event) + '\n', { mode: 0o600 });
    return event;
  }

  read(slug) {
    const file = this.fileFor(slug);
    if (!fs.existsSync(file)) return [];
    const events = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try { events.push(JSON.parse(line)); } catch {}
    }
    return events;
  }

  /**
   * Agrège la période demandée et la compare à la période précédente de même durée.
   */
  summary(slug, { days = 30, now = Date.now() } = {}) {
    days = Math.min(365, Math.max(1, Math.round(Number(days) || 30)));
    const start = now - days * DAY, prevStart = start - days * DAY;
    const all = this.read(slug);
    const current = all.filter(e => e.t >= start && e.t <= now);
    const previous = all.filter(e => e.t >= prevStart && e.t < start);
    const seenBefore = new Set(all.filter(e => e.t < start).map(e => e.c));

    const kpis = this.kpis(current, seenBefore);
    const prevKpis = this.kpis(previous, new Set(all.filter(e => e.t < prevStart).map(e => e.c)));

    // Série quotidienne (jours calendaires, heure locale du serveur)
    const daily = [];
    const first = new Date(now - (days - 1) * DAY); first.setHours(0, 0, 0, 0);
    const index = new Map();
    for (let d = 0; d < days; d++) {
      const key = localKey(first.getTime() + d * DAY + 12 * 60 * 60 * 1000);
      index.set(key, daily.length);
      daily.push({ date: key, messages: 0, contacts: 0, _c: new Set() });
    }
    const hours = Array(24).fill(0);
    const weekHours = Array.from({ length: 7 }, () => Array(24).fill(0));
    const platforms = {}, intents = {}, sentiment = { positif: 0, neutre: 0, negatif: 0 };
    const questions = new Map(), gaps = [];

    for (const e of current) {
      const pos = index.get(localKey(e.t));
      if (pos !== undefined) { daily[pos].messages++; daily[pos]._c.add(e.c); }
      const local = new Date(e.t);
      hours[local.getHours()]++;
      weekHours[(local.getDay() + 6) % 7][local.getHours()]++;
      platforms[e.p] = (platforms[e.p] || 0) + 1;
      intents[e.i] = (intents[e.i] || 0) + 1;
      sentiment[e.s] = (sentiment[e.s] || 0) + 1;
      if (e.i !== 'salutation') {
        const key = normalizeQuestion(e.q || '');
        if (key.length > 3) {
          const row = questions.get(key) || { text: e.q, count: 0, intent: e.i };
          row.count++; questions.set(key, row);
        }
      }
      if (e.o === 'escalated' && e.i !== 'salutation') gaps.push({ text: e.q, intent: e.i, at: e.t, platform: e.p });
    }
    for (const d of daily) { d.contacts = d._c.size; delete d._c; }

    const sortDesc = obj => Object.entries(obj).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
    const result = {
      period: { days, from: new Date(start).toISOString(), to: new Date(now).toISOString() },
      kpis, previous: prevKpis,
      daily, hours, weekHours,
      platforms: sortDesc(platforms),
      intents: sortDesc(intents).map(r => ({ ...r, label: INTENT_LABELS[r.key] || r.key })),
      sentiment,
      topQuestions: [...questions.values()].sort((a, b) => b.count - a.count).slice(0, 8),
      knowledgeGaps: gaps.sort((a, b) => b.at - a.at).slice(0, 10)
    };
    result.insights = this.insights(result);
    return result;
  }

  kpis(events, seenBefore) {
    const contacts = new Set(events.map(e => e.c));
    const newContacts = [...contacts].filter(c => !seenBefore.has(c)).length;
    const answered = events.filter(e => e.o === 'answered').length;
    const escalated = events.filter(e => e.o === 'escalated').length;
    const latencies = events.filter(e => e.l > 0).map(e => e.l).sort((a, b) => a - b);
    const offHours = events.filter(e => { const h = new Date(e.t).getHours(); return h < 8 || h >= 19; }).length;
    const buyers = new Set(events.filter(e => e.i === 'commande').map(e => e.c));
    return {
      messages: events.length,
      contacts: contacts.size,
      newContacts,
      returningContacts: contacts.size - newContacts,
      answerRate: events.length ? answered / events.length : 0,
      escalationRate: events.length ? escalated / events.length : 0,
      medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0,
      offHoursShare: events.length ? offHours / events.length : 0,
      purchaseIntents: buyers.size,
      leads: new Set(events.filter(e => e.lead).map(e => e.c)).size,
      complaints: events.filter(e => e.i === 'reclamation').length
    };
  }

  /**
   * Recommandations rédigées à partir des chiffres : ce que le commerçant doit faire.
   */
  insights(r) {
    const out = [], k = r.kpis, pct = v => Math.round(v * 100) + ' %';
    if (!k.messages) return [{ level: 'info', text: 'Aucun message sur la période. Partagez votre lien WhatsApp, Messenger ou web pour recevoir vos premiers clients.' }];
    if (k.offHoursShare >= 0.2) out.push({ level: 'good', text: `${pct(k.offHoursShare)} des messages sont arrivés avant 8 h ou après 19 h. Sans l'assistant, ces clients auraient attendu le lendemain.` });
    if (r.knowledgeGaps.length) {
      const top = {};
      for (const g of r.knowledgeGaps) top[g.intent] = (top[g.intent] || 0) + 1;
      const [intent] = Object.entries(top).sort((a, b) => b[1] - a[1])[0];
      const topic = intent === 'autre' ? '' : `, surtout sur « ${INTENT_LABELS[intent] || intent} »`;
      out.push({ level: 'action', text: `L'assistant n'a pas su répondre à ${r.knowledgeGaps.length} question(s)${topic}. Consultez la liste « Questions sans réponse » et complétez vos informations de référence.` });
    }
    if (k.purchaseIntents) out.push({ level: 'good', text: `${k.purchaseIntents} client(s) ont exprimé une intention d'achat${k.leads ? ` et ${k.leads} ont laissé un numéro` : ''}. Rappelez-les rapidement pour conclure.` });
    if (k.complaints) out.push({ level: 'warn', text: `${k.complaints} message(s) de réclamation. Reprenez ces conversations vous-même (tapez #pause dans la discussion).` });
    const peak = r.hours.indexOf(Math.max(...r.hours));
    out.push({ level: 'info', text: `Heure de pointe : ${peak} h – ${peak + 1} h. Publiez vos promotions juste avant pour profiter de l'affluence.` });
    const prev = r.previous.messages;
    if (prev) {
      const delta = (k.messages - prev) / prev;
      if (Math.abs(delta) >= 0.1) out.push({ level: delta > 0 ? 'good' : 'warn', text: `Volume ${delta > 0 ? 'en hausse' : 'en baisse'} de ${pct(Math.abs(delta))} par rapport à la période précédente.` });
    }
    return out;
  }

  toCsv(slug, { days = 30, now = Date.now() } = {}) {
    const start = now - Math.min(365, Math.max(1, Number(days) || 30)) * DAY;
    const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [['date', 'heure', 'canal', 'contact', 'intention', 'sentiment', 'resultat', 'latence_ms', 'message'].join(';')];
    for (const e of this.read(slug).filter(e => e.t >= start && e.t <= now)) {
      const d = new Date(e.t);
      rows.push([localKey(e.t), d.toTimeString().slice(0, 5), e.p, e.c, INTENT_LABELS[e.i] || e.i, e.s, e.o, e.l, e.q].map(esc).join(';'));
    }
    return '﻿' + rows.join('\n');
  }
}
