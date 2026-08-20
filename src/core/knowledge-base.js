/**
 * Base de Connaissances & Injection RAG (Contextuelle)
 * Structure les données de la boutique ou de l'application (produits, prix, FAQ, horaires, livraison)
 * pour les injecter de manière optimale dans le prompt DeepSeek.
 */

export class KnowledgeBase {
  /**
   * Construit le prompt système enrichi avec la base de connaissances
   * @param {Object} config - Configuration du bot (YE Education ou Boutique)
   * @param {string} platform - Canal de discussion (whatsapp, telegram, etc.)
   */
  static buildEnhancedSystemPrompt(config, platform = 'whatsapp') {
    let prompt = config.systemPrompt || '';

    prompt += `\n\n--- INFORMATIONS OFFICIELLES ET CONTEXTE (BASE DE CONNAISSANCES) ---`;
    prompt += `\n- Canal actuel : ${platform.toUpperCase()}`;

    if (config.brandName || config.businessName) {
      prompt += `\n- Entité : ${config.brandName || config.businessName}`;
    }

    if (config.city) {
      prompt += `\n- Localisation : ${config.city}`;
    }

    if (config.openingHours) {
      prompt += `\n- Horaires d'ouverture : ${config.openingHours}`;
    }

    if (config.deliveryFees) {
      prompt += `\n- Conditions de livraison : ${config.deliveryFees}`;
    }

    if (config.pricing) {
      prompt += `\n- Grille tarifaire / Abonnements :\n` + JSON.stringify(config.pricing, null, 2);
    }

    if (config.playStoreUrl) {
      prompt += `\n- Lien Téléchargement Play Store : ${config.playStoreUrl}`;
    }

    if (config.websiteUrl) {
      prompt += `\n- Site Web Officiel : ${config.websiteUrl}`;
    }

    // Injection du Catalogue de Produits / Services
    if (config.catalog && Array.isArray(config.catalog)) {
      prompt += `\n\n### 📦 CATALOGUE DE PRODUITS DISPONIBLES :`;
      for (const item of config.catalog) {
        prompt += `\n- **${item.name}** : Prix = ${item.price} FCFA`;
        if (item.sizes) prompt += ` | Tailles: ${item.sizes.join(', ')}`;
        if (item.colors) prompt += ` | Couleurs: ${item.colors.join(', ')}`;
        if (item.inStock !== undefined) prompt += ` | En stock: ${item.inStock ? 'OUI' : 'NON'}`;
      }
    }

    // Injection des FAQ prédéfinies
    if (config.faq && Array.isArray(config.faq)) {
      prompt += `\n\n### ❓ QUESTIONS FRÉQUENTES & RÉPONSES TYPE :`;
      for (const f of config.faq) {
        prompt += `\nQ: ${f.question}\nR: ${f.answer}\n`;
      }
    }

    // Injection des Documents, Liens PDF et Photos officielles
    if (config.documents || config.customDocs) {
      prompt += `\n\n### 📄 DOCUMENTS, BROCHURES PDF ET PHOTOS DE PRODUITS :`;
      prompt += `\n${config.documents || config.customDocs}`;
      prompt += `\n(Si le client demande à voir une photo ou le catalogue PDF complet, partage-lui poliment le lien direct correspondant !)`;
    }

    prompt += `\n\n--- RÈGLE D'OR COMMERCIALE ---`;
    prompt += `\nSois toujours chaleureux(se), vendeur(se) et réactif(ve). Ne parle QUE des produits et informations listées ci-dessus. Si tu ne connais pas une information non listée, propose poliment de transmettre la demande au gérant humain.`;

    return prompt;
  }
}
