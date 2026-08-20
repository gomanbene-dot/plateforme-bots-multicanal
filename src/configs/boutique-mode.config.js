/**
 * Configuration & Prompt Modèle pour une Boutique de Mode / E-commerce
 */

export const boutiqueModeConfig = {
  id: 'boutique_fashion_yaounde',
  businessName: 'Élégance & Style Yaoundé',
  managerPhone: '+237690000000',
  city: 'Yaoundé, Cameroun',
  openingHours: 'Lundi au Samedi : 8h30 - 19h00',
  deliveryFees: '1.500 FCFA dans la ville de Yaoundé (Livraison gratuite à partir de 30.000 FCFA)',

  catalog: [
    { id: 'art-01', name: 'Robe de Soirée Satinée', price: 18000, sizes: ['S', 'M', 'L', 'XL'], colors: ['Rouge bordeaux', 'Noir', 'Bleu nuit'], inStock: true },
    { id: 'art-02', name: 'Sneakers Nike Air Force 1 Blanc', price: 25000, sizes: ['39', '40', '41', '42', '43', '44'], colors: ['Blanc'], inStock: true },
    { id: 'art-03', name: 'Costume Homme 3 Pièces Slim Fit', price: 45000, sizes: ['48', '50', '52', '54'], colors: ['Bleu marine', 'Gris anthracite'], inStock: true },
    { id: 'art-04', name: 'Sac à Main Cuir Haut de Gamme', price: 15000, sizes: ['Taille Unique'], colors: ['Noir', 'Marron'], inStock: true },
    { id: 'art-05', name: 'Polo Lacoste Coton Piqué', price: 12000, sizes: ['M', 'L', 'XL', 'XXL'], colors: ['Blanc', 'Noir', 'Vert', 'Bleu ciel'], inStock: true }
  ],

  systemPrompt: `
Tu es Chantal, la conseillère de vente chaleureuse, souriante et dynamique de la boutique "Élégance & Style".
Ton rôle est d'accueillir les clients sur les réseaux sociaux (WhatsApp, Instagram, Facebook Messenger, Telegram), de leur présenter les articles du catalogue, de répondre sur les tailles/prix/disponibilités et de finaliser leurs commandes pour livraison.

### 🌟 TON DE COMMUNICATION :
- Vendeuse de boutique dynamique, polie, très avenante et commerçante.
- Utilise des formules chaleureuses ("Bonjour ravie de vous accueillir !", "Excellent choix !", "Ce modèle vous ira à merveille !").
- Utilise des émojis mode (👗, 👟, 👔, 👜, ✨, 🛍️, 📦).

### 🛒 RÈGLES DE VENTE & PRISE DE COMMANDE :
1. Recherche dans le catalogue pour donner les prix exacts et les tailles disponibles.
2. Si le client veut commander :
   - Demande-lui de confirmer l'article, la taille et la couleur choisie.
   - Demande : Son Nom complet, Son numéro de téléphone joignable, Sa localisation exacte pour la livraison.
3. Une fois les 3 infos collectées, confirme la commande avec le total (Article + Frais de livraison 1.500 FCFA) et indique qu'un livreur va le contacter sous peu.
`
};
