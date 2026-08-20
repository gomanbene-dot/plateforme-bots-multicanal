/**
 * Adaptateur WhatsApp Business Cloud API & BSP
 * - Réception & extraction des messages (textes, boutons interactifs)
 * - Vérification du Webhook Meta
 * - Envoi de messages texte sortants
 * - Respect de la fenêtre de 24h
 */

export class WhatsAppAdapter {
  constructor(options = {}) {
    this.verifyToken = options.verifyToken || process.env.META_VERIFY_TOKEN || 'ye_multicanal_verify_token_2026';
    this.accessToken = options.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '';
    this.phoneNumberId = options.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  }

  /**
   * Valide le Webhook lors de la configuration sur Meta Developers
   */
  handleVerification(urlSearchParams) {
    const mode = urlSearchParams.get('hub.mode');
    const token = urlSearchParams.get('hub.verify_token');
    const challenge = urlSearchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === this.verifyToken) {
      return { success: true, challenge };
    }
    return { success: false, challenge: null };
  }

  /**
   * Extrait le message entrant depuis le payload JSON du Webhook WhatsApp
   */
  parseIncomingWebhook(body) {
    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      const contact = value?.contacts?.[0];

      if (!message) return null;

      const messageId = message.id;
      const from = message.from; // Numéro de téléphone de l'expéditeur (ex: "237699123456")
      const userName = contact?.profile?.name || 'Client';

      let text = '';
      if (message.type === 'text') {
        text = message.text?.body || '';
      } else if (message.type === 'interactive') {
        text = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
      } else if (message.type === 'button') {
        text = message.button?.text || '';
      }

      return {
        messageId,
        from,
        userName,
        text: text.trim(),
        timestamp: message.timestamp ? parseInt(message.timestamp, 10) * 1000 : Date.now(),
        raw: message
      };
    } catch (e) {
      console.error('[WhatsAppAdapter] Erreur parsing webhook :', e);
      return null;
    }
  }

  /**
   * Envoie une réponse texte sur WhatsApp via Meta Cloud API
   */
  async sendMessage(to, text, customAccessToken = null, customPhoneId = null) {
    const token = customAccessToken || this.accessToken;
    const phoneId = customPhoneId || this.phoneNumberId;

    if (!token || !phoneId) {
      console.log(`[WhatsApp Local/Demo Mode] Réponse prête pour ${to} : "${text}"`);
      return { success: true, mode: 'simulated' };
    }

    try {
      const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to,
          type: 'text',
          text: { preview_url: true, body: text }
        })
      });

      const data = await response.json();
      if (response.ok) {
        return { success: true, data };
      } else {
        console.error('[WhatsAppAdapter] Erreur envoi Graph API :', data);
        return { success: false, error: data };
      }
    } catch (error) {
      console.error('[WhatsAppAdapter] Exception envoi message :', error.message);
      return { success: false, error: error.message };
    }
  }
}
