/**
 * Moteur IA Centralisé Multi-Canal (WhatsApp, Telegram, Messenger, Instagram, Web)
 * - Réponses ultra-concises & percutantes (spécial WhatsApp mobile)
 * - Personnalisation avec le Prénom/Nom de l'utilisateur
 * - Gestion des Quotas (20 messages gratuits, puis lien de recharge)
 * - Contrôle de pause & respect de la vie privée
 */

import { DeepSeekEngine } from './deepseek-engine.js';
import { KnowledgeBase } from './knowledge-base.js';
import { SessionManager } from './session-manager.js';

export class AiBrain {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.engine = new DeepSeekEngine(options);
    this.sessionManager = new SessionManager({ maxHistoryLength: 10 });
    
    // Système de crédits / quota de la boutique (20 messages d'essai par défaut)
    this.freeCredits = config.freeCredits ?? 20;
    this.totalCredits = config.totalCredits ?? 20;
    this.usedMessagesCount = 0;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Recharge les crédits d'une boutique après paiement
   */
  addCredits(amount) {
    this.totalCredits += amount;
    console.log(`[Credits] Rechargé de ${amount} messages. Total disponible : ${this.totalCredits - this.usedMessagesCount}`);
  }

  /**
   * Traite un message entrant avec personnalisation du nom et concision
   */
  async processMessage(senderKey, incomingMessage, platform = 'whatsapp', contextOverrides = {}) {
    if (!incomingMessage || typeof incomingMessage !== 'string' || !incomingMessage.trim()) {
      return null;
    }

    const cleanMessage = incomingMessage.trim();
    const userName = contextOverrides.userName || 'Client';

    // 1. Vérification si le numéro fait partie des contacts privés du gérant
    const rawNumber = senderKey.split(':')[1] || '';
    if (this.sessionManager.isWhitelistedPrivateContact(rawNumber)) {
      console.log(`[Privacy Protection] Contact personnel ignoré : ${senderKey}`);
      return null;
    }

    // 2. Vérification des commandes de contrôle (#stop, #pause, #play)
    const controlResult = this.sessionManager.checkControlCommands(senderKey, cleanMessage);
    if (controlResult === 'PAUSED_SILENT') {
      return null;
    }
    if (controlResult) {
      return controlResult;
    }

    // 3. Vérification du Quota / Limite de messages gratuits (20 messages d'essai)
    if (this.usedMessagesCount >= this.totalCredits) {
      console.warn(`[Quota Expiré] Limite de ${this.totalCredits} messages atteinte.`);
      const paymentUrl = this.config.paymentUrl || "https://mon-service.com/recharge";
      return `⚠️ Votre période d'essai de ${this.freeCredits} messages gratuits est terminée.\n\n👉 Pour recharger votre assistant IA (dès 500 FCFA pour 100 messages), cliquez ici : ${paymentUrl}\n\nPaiement instantané par Orange Money & MTN MoMo.`;
    }

    // Incrémentation du compteur de messages consommés
    this.usedMessagesCount++;

    // 4. Enregistrer le message de l'utilisateur
    this.sessionManager.recordUserMessage(senderKey, cleanMessage);

    // 5. Construire le prompt enrichi (concis, avec le nom du client)
    let systemPrompt = KnowledgeBase.buildEnhancedSystemPrompt(this.config, platform);
    
    // Consignes strictes de style court et appel par le prénom
    systemPrompt += `\n\n### ⚡ DIRECTIVES DE RÉPONSE EXPRESS :`;
    systemPrompt += `\n- Le client s'appelle : "${userName}". Salue-le chaleureusement par son prénom ou nom si approprié.`;
    systemPrompt += `\n- **LONGUEUR MAXIMALE : 2 à 3 phrases courtes maximum**. Fais des messages aérés, faciles et rapides à lire sur smartphone. Évite les longs pavés !`;
    systemPrompt += `\n- Termine souvent par une question d'engagement simple (ex: "En quelle classe est votre enfant ?", "Quelle taille souhaitez-vous ?").`;

    // 6. Préparer les messages pour DeepSeek
    const history = this.sessionManager.getFormattedHistory(senderKey);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history
    ];

    try {
      const result = await this.engine.generateResponse(messages, {
        apiKey: contextOverrides.apiKey || this.config.apiKey,
        temperature: this.config.temperature ?? 0.6,
        maxTokens: 250 // Réponses 2 fois plus courtes et percutantes
      });

      const replyText = result.text || `Merci pour votre message ${userName} ! Comment puis-je vous aider ? ✨`;
      this.sessionManager.recordAssistantMessage(senderKey, replyText);

      return replyText;
    } catch (error) {
      console.error(`[AiBrain] Erreur pour ${senderKey} (${platform}) :`, error);
      const fallbackReply = `Bonjour ${userName} ! Je suis Sarah de YE (Almanach). Comment puis-je vous aider aujourd'hui ? 😊`;
      this.sessionManager.recordAssistantMessage(senderKey, fallbackReply);
      return fallbackReply;
    }
  }

  canSendFreeformWhatsApp(senderKey) {
    return this.sessionManager.isWithin24HourWindow(senderKey);
  }

  clearHistory(senderKey) {
    this.sessionManager.clearSession(senderKey);
  }
}
