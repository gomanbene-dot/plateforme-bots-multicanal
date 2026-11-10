/**
 * Adaptateur Meta pour Facebook Messenger & Instagram Direct
 */

export class MetaAdapter {
  constructor(options = {}) {
    this.verifyToken = options.verifyToken || process.env.META_VERIFY_TOKEN || '';
    this.pageAccessToken = options.pageAccessToken || process.env.META_PAGE_ACCESS_TOKEN || '';
  }

  /**
   * Vérification du webhook
   */
  handleVerification(urlSearchParams) {
    const mode = urlSearchParams.get('hub.mode');
    const token = urlSearchParams.get('hub.verify_token');
    const challenge = urlSearchParams.get('hub.challenge');

    if (mode === 'subscribe' && this.verifyToken && token === this.verifyToken) {
      return { success: true, challenge };
    }
    return { success: false, challenge: null };
  }

  /**
   * Extrait le message Messenger ou Instagram
   */
  parseIncomingWebhooks(body) {
    return (body?.entry || []).flatMap(entry => (entry.messaging || []).map(messaging => this.parseIncomingWebhook({entry:[{messaging:[messaging]}]}))).filter(Boolean);
  }

  parseIncomingWebhook(body) {
    try {
      const messaging = body?.entry?.[0]?.messaging?.[0];
      if (!messaging || !messaging.message || !messaging.message.text || messaging.message.is_echo) return null;

      return {
        messageId: messaging.message.mid,
        senderId: messaging.sender.id,
        recipientId: messaging.recipient.id,
        text: messaging.message.text.trim(),
        timestamp: messaging.timestamp || Date.now()
      };
    } catch (e) {
      console.error('[MetaAdapter] Erreur parsing :', e);
      return null;
    }
  }

  /**
   * Envoi d'un message sur Messenger ou Instagram Direct
   */
  async sendMessage(recipientId, text, customToken = null, channel = {}) {
    const token = customToken || this.pageAccessToken;
    if (!token) {
      console.log(`[Meta Messenger/IG Local Mode] Réponse prête pour ${recipientId} : "${text}"`);
      return { success: false, error: 'CHANNEL_NOT_CONFIGURED' };
    }

    try {
      const res = await fetch(`https://${channel.instagramLogin ? 'graph.instagram.com' : 'graph.facebook.com'}/${process.env.META_GRAPH_VERSION || 'v23.0'}/${encodeURIComponent(channel.accountId || 'me')}/messages`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+token },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: text }
        })
      });
      const data = await res.json();
      return { success: res.ok, data };
    } catch (e) {
      console.error('[MetaAdapter] Erreur envoi :', e.message);
      return { success: false, error: e.message };
    }
  }
}
