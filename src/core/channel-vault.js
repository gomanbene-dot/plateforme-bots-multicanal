/**
 * Coffre des réseaux connectés.
 *
 * Chaque entreprise connecte ses propres comptes (page Facebook, compte Instagram,
 * numéro WhatsApp, bot Telegram). Les jetons d'accès reçus de Meta ou de Telegram
 * sont chiffrés (AES-256-GCM) avant d'être écrits sur le disque : un fichier volé
 * sans la clé ne donne accès à aucun compte.
 *
 * Clé de chiffrement : variable CHANNEL_ENCRYPTION_KEY (64 caractères hexadécimaux),
 * sinon un fichier vault.key généré une fois dans le dossier privé.
 * Perdre cette clé oblige les entreprises à reconnecter leurs réseaux.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';

const PLATFORMS = ['whatsapp', 'messenger', 'instagram', 'telegram'];

export class ChannelVault {
  constructor(dir, { key = process.env.CHANNEL_ENCRYPTION_KEY } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'channels-vault.json');
    if (key && !/^[0-9a-f]{64}$/i.test(key)) throw Error('CHANNEL_ENCRYPTION_KEY doit contenir 64 caractères hexadécimaux');
    if (!key) {
      const keyFile = path.join(dir, 'vault.key');
      if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
      key = fs.readFileSync(keyFile, 'utf8').trim();
    }
    this.key = Buffer.from(key, 'hex');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { channels: {} };
  }

  encrypt(text) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
  }

  decrypt(blob) {
    const [iv, tag, enc] = String(blob).split('.').map(s => Buffer.from(s, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }

  persist() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }

  /**
   * Enregistre (ou remplace) un réseau connecté.
   * routeId : identifiant présent dans les messages reçus (page, compte Instagram, numéro WhatsApp, bot).
   * sendId  : identifiant utilisé pour envoyer (la page pour Instagram, sinon routeId).
   */
  connect({ merchantSlug, platform, routeId, sendId, name, token, secret, extra = {} }) {
    if (!PLATFORMS.includes(platform)) throw Error('Réseau inconnu');
    if (!merchantSlug || !routeId || !token) throw Error('Connexion incomplète');
    const key = platform + ':' + routeId;
    const owner = this.data.channels[key]?.merchantSlug;
    if (owner && owner !== merchantSlug) throw Error('Ce compte est déjà relié à une autre entreprise');
    this.data.channels[key] = {
      merchantSlug, platform, routeId: String(routeId), sendId: String(sendId || routeId),
      name: String(name || '').slice(0, 120), connectedAt: Date.now(),
      token: this.encrypt(token), ...(secret ? { secret: this.encrypt(secret) } : {}), extra
    };
    this.persist();
    return this.publicView(key);
  }

  disconnect(merchantSlug, platform, routeId) {
    const key = platform + ':' + routeId, row = this.data.channels[key];
    if (!row || row.merchantSlug !== merchantSlug) return null;
    const full = this.resolve(platform, routeId);
    delete this.data.channels[key];
    this.persist();
    return full;
  }

  /** Canal complet (jeton déchiffré) pour recevoir ou envoyer. Usage serveur uniquement. */
  resolve(platform, routeId) {
    const row = this.data.channels[platform + ':' + routeId];
    if (!row) return null;
    try {
      return { ...row, token: this.decrypt(row.token), secret: row.secret ? this.decrypt(row.secret) : undefined };
    } catch {
      console.warn('[Coffre] Jeton illisible pour', platform, routeId, '(clé de chiffrement changée ?)');
      return null;
    }
  }

  /** Vérifie un secret (webhook Telegram) en temps constant. */
  checkSecret(platform, routeId, candidate) {
    const ch = this.resolve(platform, routeId);
    if (!ch?.secret || typeof candidate !== 'string') return null;
    const a = createHmac('sha256', this.key).update(ch.secret).digest();
    const b = createHmac('sha256', this.key).update(candidate).digest();
    return timingSafeEqual(a, b) ? ch : null;
  }

  publicView(key) {
    const { token, secret, ...rest } = this.data.channels[key];
    return rest;
  }

  listFor(merchantSlug) {
    return Object.keys(this.data.channels)
      .filter(k => this.data.channels[k].merchantSlug === merchantSlug)
      .map(k => this.publicView(k));
  }
}
