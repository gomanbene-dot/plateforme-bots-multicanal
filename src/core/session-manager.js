/**
 * Gestionnaire de Sessions & Contrôle de Conversations
 * - Détection des commandes de contrôle (#stop, #pause, #play)
 * - Liste blanche des numéros privés du gérant
 * - Conformité à la fenêtre 24h WhatsApp
 * - Déduplication anti-doublons Meta
 */

export class SessionManager {
  constructor(options = {}) {
    this.maxHistoryLength = options.maxHistoryLength || 12;
    this.sessions = new Map(); // sessionId -> { history: [], lastUserActivity: timestamp, isPaused: boolean, pausedUntil: timestamp }
    this.processedMessageIds = new Map(); // messageId -> timestamp
    this.whitelistNumbers = new Set(
      (process.env.PERSONAL_WHITELIST_NUMBERS || '')
        .split(',')
        .map(n => n.trim().replace(/[^0-9]/g, ''))
        .filter(Boolean)
    );
  }

  /**
   * Vérifie si un numéro fait partie de la liste personnelle du gérant à ignorer
   */
  isWhitelistedPrivateContact(rawSender) {
    const cleanNumber = (rawSender || '').replace(/[^0-9]/g, '');
    if (!cleanNumber) return false;
    return this.whitelistNumbers.has(cleanNumber);
  }

  /**
   * Vérifie et applique les commandes de contrôle (#stop, #pause, #play)
   * @returns {string|null} Retourne un message de confirmation ou null si message normal
   */
  checkControlCommands(sessionId, messageText) {
    const text = (messageText || '').trim().toLowerCase();
    const session = this.getSession(sessionId);

    if (text === '#stop' || text === '#pause') {
      session.isPaused = true;
      session.pausedUntil = Date.now() + 2 * 60 * 60 * 1000; // Pause de 2 heures
      return "⏸️ Le bot IA est désormais en PAUSE sur cette discussion. L'humain a la main. Tapez #play pour réactiver.";
    }

    if (text === '#play' || text === '#reprendre' || text === '#start') {
      session.isPaused = false;
      session.pausedUntil = null;
      return "▶️ Le bot IA est de nouveau ACTIF et répondra aux prochains messages.";
    }

    // Vérifier si la pause est toujours active
    if (session.isPaused) {
      if (session.pausedUntil && Date.now() > session.pausedUntil) {
        session.isPaused = false; // Expiration de la pause automatique
        return null;
      }
      return 'PAUSED_SILENT'; // Indique que le bot doit rester silencieux
    }

    return null;
  }

  /**
   * Vérifie si un message est un doublon (anti-retry Meta)
   */
  isDuplicateMessage(messageId) {
    if (!messageId) return false;
    
    const now = Date.now();
    for (const [id, time] of this.processedMessageIds.entries()) {
      if (now - time > 10 * 60 * 1000) {
        this.processedMessageIds.delete(id);
      }
    }

    if (this.processedMessageIds.has(messageId)) {
      return true;
    }

    this.processedMessageIds.set(messageId, now);
    return false;
  }

  /**
   * Récupère ou initialise la session d'un utilisateur
   */
  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        history: [],
        lastUserActivity: Date.now(),
        isPaused: false,
        pausedUntil: null,
        metadata: {}
      });
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Enregistre le message utilisateur et met à jour le compteur 24h
   */
  recordUserMessage(sessionId, messageText) {
    const session = this.getSession(sessionId);
    session.lastUserActivity = Date.now();
    session.history.push({ role: 'user', content: messageText });

    this._trimHistory(session);
    return session.history;
  }

  /**
   * Enregistre la réponse de l'assistant
   */
  recordAssistantMessage(sessionId, messageText) {
    const session = this.getSession(sessionId);
    session.history.push({ role: 'assistant', content: messageText });

    this._trimHistory(session);
    return session.history;
  }

  /**
   * Vérifie si la fenêtre de 24h WhatsApp est respectée
   */
  isWithin24HourWindow(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.lastUserActivity) return false;

    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    return (Date.now() - session.lastUserActivity) < TWENTY_FOUR_HOURS;
  }

  getFormattedHistory(sessionId) {
    const session = this.getSession(sessionId);
    return [...session.history];
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  _trimHistory(session) {
    if (session.history.length > this.maxHistoryLength) {
      session.history.splice(0, session.history.length - this.maxHistoryLength);
    }
  }
}
