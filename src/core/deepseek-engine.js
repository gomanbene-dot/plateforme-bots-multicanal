/**
 * Moteur LLM DeepSeek officiel & intelligent avec Moteur Local Enrichi
 */

export class DeepSeekEngine {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = options.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    this.model = options.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.fallbackGeminiKey = options.fallbackGeminiKey || process.env.GEMINI_API_KEY || '';
  }

  /**
   * Génère une réponse via DeepSeek
   */
  async generateResponse(messages, options = {}) {
    const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || this.apiKey;
    const model = options.model || this.model;

    // 1. Appel officiel à l'API DeepSeek si la clé est présente
    if (apiKey && apiKey.trim().length > 5) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`
          },
          body: JSON.stringify({
            model: model,
            messages: messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 700,
            stream: false
          })
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            return {
              text: content.trim(),
              provider: 'deepseek',
              model: model,
              usage: data.usage
            };
          }
        } else {
          const errorText = await response.text();
          console.warn(`[DeepSeek API] Erreur (${response.status}) : ${errorText}`);
        }
      } catch (err) {
        console.error('[DeepSeek] Erreur réseau / API :', err.message);
      }
    }

    // 2. Fallback Gemini si disponible
    const geminiKey = process.env.GEMINI_API_KEY || this.fallbackGeminiKey;
    if (geminiKey && geminiKey.trim().length > 5) {
      try {
        const geminiResponse = await this._callGeminiFallback(messages, geminiKey.trim());
        if (geminiResponse) {
          return {
            text: geminiResponse,
            provider: 'gemini-fallback',
            model: 'gemini-1.5-flash'
          };
        }
      } catch (err) {
        console.warn('[Gemini Fallback] Erreur :', err.message);
      }
    }

    // 3. Moteur Local Contextuel (Mode Sans Clé API)
    return {
      text: this._generateLocalSmartResponse(messages),
      provider: 'local-smart-engine',
      model: 'local-knowledge-engine'
    };
  }

  async _callGeminiFallback(messages, apiKey) {
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const userAndAssistant = messages.filter(m => m.role !== 'system');

    const contents = [
      ...(systemMessage ? [{ role: 'user', parts: [{ text: `INSTRUCTIONS DU SYSTÈME :\n${systemMessage}` }] }] : []),
      ...userAndAssistant.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    ];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
        })
      }
    );

    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    }
    return null;
  }

  /**
   * Moteur local enrichi capable de répondre intelligemment sur l'application YE et les commerces
   */
  _generateLocalSmartResponse(messages) {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() || '';

    if (lastUserMessage.includes('qui es tu') || lastUserMessage.includes('qui est tu') || lastUserMessage.includes('t\'es qui') || lastUserMessage.includes('tu es qui')) {
      return "Je suis Sarah, la conseillère d'orientation et d'accompagnement de l'application éducative **YE (Almanach)** ! 📚✨\n\nMon rôle est de vous aider à découvrir nos outils pour garantir la réussite scolaire de votre enfant de la 6ème à la Terminale. En quelle classe est votre enfant ?";
    }

    if (lastUserMessage.includes('appli') || lastUserMessage.includes('application') || lastUserMessage.includes('en dire plus') || lastUserMessage.includes('c\'est quoi') || lastUserMessage.includes('fonctionne')) {
      return "L'application **YE (Almanach)** est le répétiteur virtuel intelligent n°1 au Cameroun ! 🚀\n\n✅ **100% Hors-Ligne** : zéro connexion Internet nécessaire pour réviser.\n✅ **De la 6ème à la Terminale** (Toutes séries & anglophone Form 1 - Upper 6th).\n✅ **Cours complets, résumés, quiz et corrigés d'examens** (BEPC, Probatoire, Bac, GCE).\n✅ **Tuteur IA 24h/24** pour expliquer les devoirs.\n\nSouhaitez-vous le lien pour la tester gratuitement ?";
    }

    if (lastUserMessage.includes('prix') || lastUserMessage.includes('tarif') || lastUserMessage.includes('combien') || lastUserMessage.includes('payer') || lastUserMessage.includes('abonnement')) {
      return "Nos tarifs sont pensés pour être accessibles à tous les parents : 💎\n\n📌 **Mensuel** : 2.500 FCFA / mois\n📌 **Trimestriel** : 6.000 FCFA / trimestre\n📌 **Annuel (Recommandé)** : 15.000 FCFA / an (soit seulement 1.250 FCFA/mois !)\n\n💳 Paiement direct par **Orange Money** et **MTN Mobile Money**.";
    }

    if (lastUserMessage.includes('lien') || lastUserMessage.includes('telecharger') || lastUserMessage.includes('télécharger') || lastUserMessage.includes('installer') || lastUserMessage.includes('play store')) {
      return "Voici le lien officiel pour installer l'application sur votre téléphone Android : 📲\n\n👉 **Télécharger sur le Play Store :** https://play.google.com/store/apps/details?id=cm.ye.almanach\n\nInstallez-la et testez gratuitement les premiers chapitres !";
    }

    if (lastUserMessage.includes('bonjour') || lastUserMessage.includes('salut') || lastUserMessage.includes('bonsoir') || lastUserMessage.includes('/start')) {
      return "Bonjour et bienvenue chez **YE (Almanach)** ! 📚✨ Je suis Sarah, votre conseillère pédagogique.\n\nComment puis-je vous aider aujourd'hui ? (Présentation de l'app, tarifs, lien de téléchargement, classes disponibles...)";
    }

    return "Merci pour votre message ! 😊 Chez **YE (Almanach)**, nous accompagnons les élèves de la 6ème à la Terminale avec des cours et exercices 100% hors-ligne.\n\nSouhaitez-vous connaître nos tarifs ou obtenir le lien de téléchargement gratuit ?";
  }
}
