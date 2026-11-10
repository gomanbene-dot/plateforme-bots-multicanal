/**
 * Adaptateur WhatsApp Web (Baileys Multi-Device)
 * Permet la connexion en scannant un QR Code depuis n'importe quel smartphone
 * (WhatsApp > Appareils connectés), sans compte développeur Meta.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WhatsAppBaileysAdapter {
  /**
   * @param {Object} options
   * @param {string} options.sessionId - Identifiant de la session (ex: 'ye_principal' ou 'boutique_xyz')
   * @param {Function} options.onMessage - Callback appelé lorsqu'un message textuel arrive
   */
  constructor(options = {}) {
    this.sessionId = options.sessionId || 'ye_principal';
    this.onMessage = options.onMessage || null;

    this.sessionsDir = path.join(__dirname, '..', '..', 'auth_sessions', this.sessionId);
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    this.sock = null;
    this.status = 'DISCONNECTED'; // 'DISCONNECTED' | 'SCAN_NEEDED' | 'CONNECTING' | 'CONNECTED'
    this.currentQrCode = null; // Base64 data URL
    this.rawQrString = null;
    this.connectedUser = null;
    this.reconnectAttempts = 0;
    this.isStarting = false;
  }

  /**
   * Démarre la connexion Baileys
   */
  async start() {
    if (this.isStarting || this.status === 'CONNECTED') {
      return;
    }
    this.isStarting = true;
    this.status = 'CONNECTING';

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionsDir);
      const { version } = await fetchLatestBaileysVersion();

      console.log(`[WhatsApp Web] Initialisation Baileys (WA v${version.join('.')}) - Session: ${this.sessionId}`);

      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state,
        browser: ['YE Assistant IA', 'Chrome', '1.0.0'],
        syncFullHistory: false
      });

      // Écoute de l'état de connexion & génération du QR Code
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.rawQrString = qr;
          this.status = 'SCAN_NEEDED';
          try {
            this.currentQrCode = await QRCode.toDataURL(qr, {
              margin: 2,
              width: 280,
              color: {
                dark: '#0f172a',
                light: '#ffffff'
              }
            });
            console.log(`[WhatsApp Web] 📲 Nouveau QR Code prêt à être scanné pour la session : ${this.sessionId}`);
          } catch (err) {
            console.error('[WhatsApp Web] Erreur génération QR Code DataURL :', err);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[WhatsApp Web] Connexion fermée (Code: ${statusCode}). Reconnexion: ${shouldReconnect}`);

          if (statusCode === DisconnectReason.loggedOut) {
            this.status = 'DISCONNECTED';
            this.currentQrCode = null;
            this.connectedUser = null;
            // Supprimer les fichiers de session si déconnecté volontairement
            try {
              fs.rmSync(this.sessionsDir, { recursive: true, force: true });
            } catch (e) {}
          } else if (shouldReconnect) {
            this.status = 'CONNECTING';
            setTimeout(() => {
              this.isStarting = false;
              this.start();
            }, 3000);
          } else {
            this.status = 'DISCONNECTED';
          }
        } else if (connection === 'open') {
          this.status = 'CONNECTED';
          this.currentQrCode = null;
          this.reconnectAttempts = 0;
          this.connectedUser = this.sock.user || null;
          console.log(`[WhatsApp Web] ✅ Connecté avec succès ! Numéro : ${this.sock.user?.id || 'Inconnu'}`);
        }
      });

      // Sauvegarde des identifiants d'authentification
      this.sock.ev.on('creds.update', saveCreds);

      // Écoute des messages entrants
      this.sock.ev.on('messages.upsert', async (m) => {
        try {
          if (!m.messages || !m.messages.length) return;

          for (const msg of m.messages) {
            // Ignorer les messages envoyés par le bot lui-même
            if (msg.key.fromMe) continue;

            const remoteJid = msg.key.remoteJid;
            // 1. Ignorer impérativement les groupes WhatsApp, diffusions et statuts
            if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) {
              continue;
            }

            // Extraire le texte du message
            const messageContent = msg.message;
            if (!messageContent) continue;

            const text = (
              messageContent.conversation ||
              messageContent.extendedTextMessage?.text ||
              messageContent.imageMessage?.caption ||
              messageContent.videoMessage?.caption ||
              ''
            ).trim();

            if (!text) continue;

            const senderPhone = remoteJid.replace(/@.*$/, '');
            const pushName = msg.pushName || 'Client';

            // 2. Vérification liste blanche des numéros personnels à ignorer
            const whitelist = (process.env.PERSONAL_WHITELIST_NUMBERS || '')
              .split(',')
              .map(n => n.trim().replace(/[^0-9]/g, ''))
              .filter(Boolean);

            if (whitelist.length > 0 && whitelist.some(n => senderPhone.includes(n))) {
              console.log(`[WhatsApp Web Filter] Message personnel ignoré pour numéro whitelisté : ${senderPhone}`);
              continue;
            }

            // 3. Détection d'intention : éviter de répondre aux messages purement privés
            if (!this.isRelevantBusinessMessage(text)) {
              console.log(`[WhatsApp Web Filter] Message non commercial/non éducatif ignoré : "${text}" de ${pushName}`);
              continue;
            }

            console.log(`[WhatsApp Web In] De ${pushName} (${senderPhone}) : "${text}"`);

            // Si un gestionnaire de message est défini
            if (typeof this.onMessage === 'function') {
              const reply = await this.onMessage({
                senderKey: `whatsapp:${senderPhone}`,
                senderPhone,
                pushName,
                text,
                remoteJid
              });

              if (reply && typeof reply === 'string') {
                await this.sendMessage(remoteJid, reply);
              }
            }
          }
        } catch (err) {
          console.error('[WhatsApp Web] Erreur traitement message entrant :', err);
        }
      });

    } catch (error) {
      console.error('[WhatsApp Web] Erreur démarrage Baileys :', error);
      this.status = 'DISCONNECTED';
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Envoie un message texte sur un chat WhatsApp (JID ou numéro)
   */
  async sendMessage(remoteJid, text) {
    if (!this.sock || this.status !== 'CONNECTED') {
      console.warn('[WhatsApp Web] Impossible d\'envoyer le message : client non connecté');
      return false;
    }

    try {
      const formattedJid = remoteJid.includes('@') ? remoteJid : `${remoteJid}@s.whatsapp.net`;
      await this.sock.sendMessage(formattedJid, { text });
      console.log(`[WhatsApp Web Out] Message envoyé à ${formattedJid} : "${text.slice(0, 40)}..."`);
      return true;
    } catch (err) {
      console.error('[WhatsApp Web] Erreur envoi message :', err);
      return false;
    }
  }

  /**
   * Déconnexion manuelle (Logout)
   */
  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (e) {}

    this.status = 'DISCONNECTED';
    this.currentQrCode = null;
    this.connectedUser = null;

    try {
      fs.rmSync(this.sessionsDir, { recursive: true, force: true });
    } catch (e) {}

    return true;
  }

  /**
   * Détection intelligente d'intention commerciale / éducative
   * Évite de répondre aux messages purement privés (famille, amis)
   */
  isRelevantBusinessMessage(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase().trim();

    // Commandes de contrôle (#pause, #play, etc.)
    if (lower.startsWith('#') || lower.startsWith('/')) return true;

    // Salutations courantes
    const greetings = ['bonjour', 'bonsoir', 'salut', 'hello', 'hi', 'aide', 'info', 'renseignement', 'contact', 'besoin'];

    // Mots-clés éducatifs / commerciaux
    const keywords = [
      'ye', 'yé', 'almanach', 'cours', 'appli', 'application', 'classe', 'niveau', 'matiere', 'matière',
      'bepc', 'bac', 'probatoire', 'gce', 'examen', 'exercice', 'livre', 'tuteur',
      'prix', 'tarif', 'cout', 'coût', 'combien', 'payer', 'abonnement', 'inscri',
      'enfant', 'fils', 'fille', 'eleve', 'élève', 'parent', 'ecole', 'école', 'college', 'collège', 'lycee', 'lycée',
      '6eme', '6ème', '5eme', '5ème', '4eme', '4ème', '3eme', '3ème', 'seconde', 'premiere', 'première', 'terminale',
      'telecharger', 'télécharger', 'installer', 'play store', 'apk', 'momo', 'orange', 'mtn',
      'boutique', 'produit', 'disponible', 'commande', 'livraison', 'taille', 'couleur'
    ];

    return greetings.some(g => lower.includes(g)) || keywords.some(k => lower.includes(k));
  }

  /**
   * Retourne l'état actuel de la connexion et le QR code pour l'interface web
   */
  getStatus() {
    return {
      status: this.status,
      qrCode: this.currentQrCode,
      user: this.connectedUser ? {
        id: this.connectedUser.id?.replace(/@.*$/, ''),
        name: this.connectedUser.name || 'WhatsApp Connecté'
      } : null,
      sessionId: this.sessionId
    };
  }
}
