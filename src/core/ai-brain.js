/**
 * Moteur IA Multi-Boutiques Dynamique avec Support Deep-Linking (ex: /start boutique_nom)
 * Permet à chaque commerçant d'avoir son propre lien sans intervention manuelle.
 */

import { DeepSeekEngine } from './deepseek-engine.js';
import { KnowledgeBase } from './knowledge-base.js';
import { SessionManager } from './session-manager.js';
import { classifyIntent, isEscalation } from './analytics.js';

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
    if (cleanSlug === this.defaultConfig.id) return this.defaultConfig;
    return this.merchantCache.get(cleanSlug) || null;
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
    // Le canal appartient à une entreprise ; un visiteur ne peut pas le réaffecter.
    const target = contextOverrides.merchantSlug || this.defaultConfig.id;
    const activeConfig = this.getMerchantConfig(target);
    if (!activeConfig) return 'Cet assistant est indisponible. Vérifiez le lien de votre entreprise.';
    const startedAt = Date.now();
    const track = (reply, outcome) => this.track(target, { contact: platform + ':' + senderKey, platform, message: cleanMessage, reply, outcome, latencyMs: Date.now() - startedAt });
    const rawKey = String(senderKey);
    const contact = rawKey.startsWith(platform + ':') ? rawKey.slice(platform.length + 1) : rawKey;
    senderKey = JSON.stringify([target, platform, senderKey]);
    const session = this.sessionManager.getSession(senderKey);

    // 1. Boîte de réception unifiée : chaque message client y est rangé, quel que soit le réseau
    const convId = this.inboxCall(i => i.recordIncoming(target, { platform, contact, name: userName, text: cleanMessage, sessionKey: senderKey, delivery: contextOverrides.delivery }).id);
    const out = text => { if (convId && text) this.inboxCall(i => i.recordOutgoing(target, convId, { from: 'bot', text })); return text; };

    // Un membre de l'équipe a repris la main : l'IA se tait mais garde le fil pour la suite
    if (convId && this.inboxCall(i => i.isHumanActive(target, convId))) {
      this.sessionManager.recordUserMessage(senderKey, cleanMessage);
      track(null, 'human');
      return null;
    }

    // 2. Vérification des commandes de contrôle (#stop, #pause, #play)
    const controlResult = this.sessionManager.checkControlCommands(senderKey, cleanMessage);
    if (controlResult === 'PAUSED_SILENT') return null;
    if (controlResult) return out(controlResult);

    // 3. Vérification des crédits de la boutique
    if (activeConfig.credits_remaining !== undefined && activeConfig.credits_remaining <= 0) {
      track(null, 'no_credit');
      if (convId) this.inboxCall(i => i.flag(target, convId, 'Crédits épuisés : le client attend une réponse'));
      return out('Cet assistant est temporairement indisponible. Contactez directement l’entreprise.');
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
    systemPrompt += `\n- Le client s'appelle : "${userName}". Salue-le avec respect si opportun.`;
    systemPrompt += `\n- **LONGUEUR : 2 à 3 phrases courtes et fluides maximum**. Pas de pavés.`;
    if (activeConfig.styleSettings?.emojiLevel === 'none') {
      systemPrompt += `\n- **INTERDICTION D'ÉMOJIS : N'inclus ABSOLUMENT AUCUN émoji ni symbole graphique**. Zéro fusée, zéro coche, zéro étoile. Texte pur naturel.`;
    }
    systemPrompt += `\n- Réponds UNIQUEMENT sur les caractéristiques et conditions de ${activeConfig.businessName || activeConfig.brandName || 'notre service'}.`;

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

      track(replyText);
      if (convId) {
        const intent = classifyIntent(cleanMessage);
        const reason = intent === 'reclamation' ? 'Réclamation du client'
          : isEscalation(replyText) ? 'L’assistant n’a pas su répondre'
          : intent === 'commande' ? 'Client prêt à acheter' : null;
        if (reason) this.inboxCall(i => i.flag(target, convId, reason));
      }
      return out(replyText);
    } catch (error) {
      console.error(`[AiBrain] Erreur pour ${senderKey} :`, error);
      if (activeConfig.credits_remaining !== undefined) activeConfig.credits_remaining++;
      const fallback = 'Le service de réponse est momentanément indisponible.' + (activeConfig.supportEmail ? ' Contact : ' + activeConfig.supportEmail : ' Contactez directement cette entreprise.');
      this.sessionManager.recordAssistantMessage(senderKey, fallback);
      track(fallback, 'error');
      if (convId) this.inboxCall(i => i.flag(target, convId, 'Service IA indisponible'));
      return out(fallback);
    }
  }

  /** Appel protégé à la boîte de réception : une erreur de stockage ne bloque jamais la réponse. */
  inboxCall(fn) {
    if (!this.inbox) return null;
    try { return fn(this.inbox); } catch (err) { console.warn('[Inbox]', err.message); return null; }
  }

  /** Ajoute la réponse d'un humain à l'historique IA, pour que l'assistant reprenne avec le contexte. */
  recordAgentMessage(sessionKey, text) {
    if (sessionKey) this.sessionManager.recordAssistantMessage(sessionKey, text);
  }

  /**
   * Transmet l'échange au module d'analyse s'il est branché ; une erreur d'écriture
   * ne doit jamais empêcher le client de recevoir sa réponse.
   */
  track(slug, event) {
    if (!this.analytics) return;
    try { this.analytics.record(slug, event); } catch (err) { console.warn('[Analytics]', err.message); }
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
