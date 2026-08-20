/**
 * Moteur IA Multi-Boutiques Dynamique avec Support Deep-Linking (ex: /start boutique_nom)
 * Permet à chaque commerçant d'avoir son propre lien sans intervention manuelle.
 */

import { DeepSeekEngine } from './deepseek-engine.js';
import { KnowledgeBase } from './knowledge-base.js';
import { SessionManager } from './session-manager.js';

export class AiBrain {
  constructor(defaultConfig = {}, options = {}) {
    this.defaultConfig = defaultConfig;
    this.engine = new DeepSeekEngine(options);
    this.sessionManager = new SessionManager({ maxHistoryLength: 10 });
    
    // Cache des boutiques en mémoire pour une vitesse instantanée
    this.merchantCache = new Map(); // slug -> merchantData
  }

  /**
   * Enregistre ou met à jour une boutique dans le cache
   */
  registerMerchant(slug, merchantData) {
    const cleanSlug = (slug || '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
    this.merchantCache.set(cleanSlug, {
      ...merchantData,
      slug: cleanSlug,
      credits_remaining: merchantData.credits_remaining ?? 20,
      total_messages_processed: merchantData.total_messages_processed ?? 0
    });
    console.log(`[Multi-Tenant] Boutique enregistrée en mémoire : ${cleanSlug}`);
    return cleanSlug;
  }

  /**
   * Récupère la configuration d'une boutique par son slug ou retourne la config par défaut (YE)
   */
  getMerchantConfig(slug) {
    if (!slug) return this.defaultConfig;
    const cleanSlug = slug.toLowerCase().trim();
    return this.merchantCache.get(cleanSlug) || this.defaultConfig;
  }

  /**
   * Traite un message entrant avec résolution automatique de la boutique par deep-linking
   */
  async processMessage(senderKey, incomingMessage, platform = 'whatsapp', contextOverrides = {}) {
    if (!incomingMessage || typeof incomingMessage !== 'string' || !incomingMessage.trim()) {
      return null;
    }

    const cleanMessage = incomingMessage.trim();
    const userName = contextOverrides.userName || 'Client';
    const session = this.sessionManager.getSession(senderKey);

    // 1. Détection du Deep-Linking (ex: "/start boutique_kfashion" ou "START=boutique_kfashion")
    if (cleanMessage.startsWith('/start') || cleanMessage.startsWith('START=')) {
      const parts = cleanMessage.split(/[\s=]+/);
      if (parts.length > 1) {
        const potentialSlug = parts[1].toLowerCase().trim();
        if (this.merchantCache.has(potentialSlug)) {
          session.activeMerchantSlug = potentialSlug;
          console.log(`[DeepLink] Utilisateur ${senderKey} rattaché à la boutique : ${potentialSlug}`);
        }
      }
    }

    // Déterminer la boutique active pour cette conversation
    const activeSlug = contextOverrides.merchantSlug || session.activeMerchantSlug;
    const activeConfig = this.getMerchantConfig(activeSlug);

    // 2. Vérification des commandes de contrôle (#stop, #pause, #play)
    const controlResult = this.sessionManager.checkControlCommands(senderKey, cleanMessage);
    if (controlResult === 'PAUSED_SILENT') return null;
    if (controlResult) return controlResult;

    // 3. Vérification des crédits de la boutique
    if (activeConfig.credits_remaining !== undefined && activeConfig.credits_remaining <= 0) {
      const paymentUrl = `https://plateforme-bots-multicanal-production.up.railway.app/recharge?shop=${activeConfig.slug || 'default'}`;
      return `⚠️ L'assistant IA de ${activeConfig.businessName || 'cette boutique'} a épuisé ses crédits d'essai gratuits.\n\n👉 Pour recharger l'assistant (dès 500 FCFA), cliquez ici : ${paymentUrl}`;
    }

    // Décrémenter les crédits si applicable
    if (activeConfig.credits_remaining !== undefined) {
      activeConfig.credits_remaining--;
      activeConfig.total_messages_processed = (activeConfig.total_messages_processed || 0) + 1;
    }

    // 4. Enregistrer le message utilisateur
    this.sessionManager.recordUserMessage(senderKey, cleanMessage);

    // 5. Construire le prompt enrichi avec les informations de la boutique choisie
    let systemPrompt = KnowledgeBase.buildEnhancedSystemPrompt(activeConfig, platform);
    systemPrompt += `\n\n### ⚡ DIRECTIVES DE RÉPONSE EXPRESS :`;
    systemPrompt += `\n- Le client s'appelle : "${userName}". Salue-le chaleureusement par son nom si opportun.`;
    systemPrompt += `\n- **LONGUEUR MAXIMALE : 2 à 3 phrases courtes maximum**. Aéré, direct et facile à lire sur smartphone.`;
    systemPrompt += `\n- Réponds UNIQUEMENT sur les produits et conditions de ${activeConfig.businessName || 'notre service'}.`;

    // 6. Préparer les messages pour DeepSeek
    const history = this.sessionManager.getFormattedHistory(senderKey);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history
    ];

    try {
      const result = await this.engine.generateResponse(messages, {
        apiKey: contextOverrides.apiKey || activeConfig.apiKey,
        temperature: 0.6,
        maxTokens: 250
      });

      const replyText = result.text || `Bonjour ${userName} ! Comment puis-je vous renseigner chez ${activeConfig.businessName || 'nous'} ? 😊`;
      this.sessionManager.recordAssistantMessage(senderKey, replyText);

      // Enregistrer dans l'historique de la boutique pour le Dashboard
      if (!activeConfig.recentConversations) activeConfig.recentConversations = [];
      activeConfig.recentConversations.unshift({
        senderName: userName,
        senderKey: senderKey,
        platform: platform,
        userMessage: cleanMessage,
        botReply: replyText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toLocaleDateString()
      });
      if (activeConfig.recentConversations.length > 50) activeConfig.recentConversations.pop();

      return replyText;
    } catch (error) {
      console.error(`[AiBrain] Erreur pour ${senderKey} :`, error);
      const fallback = `Bonjour ${userName} ! Bienvenue chez ${activeConfig.businessName || 'nous'}. Comment puis-je vous aider ? ✨`;
      this.sessionManager.recordAssistantMessage(senderKey, fallback);
      return fallback;
    }
  }

  getMerchantConversations(slug) {
    const config = this.getMerchantConfig(slug);
    return config?.recentConversations || [];
  }

  canSendFreeformWhatsApp(senderKey) {
    return this.sessionManager.isWithin24HourWindow(senderKey);
  }

  clearHistory(senderKey) {
    this.sessionManager.clearSession(senderKey);
  }
}
