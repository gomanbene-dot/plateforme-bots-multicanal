# Activer la connexion des réseaux en un clic

Ce guide est pour **vous, l'opérateur de la plateforme**. Vous le faites **une seule fois**.
Ensuite, chaque client connecte ses propres réseaux depuis son espace (onglet **Réseaux**),
sans jamais voir ni saisir de clé technique.

## Comment ça marche pour le client

| Réseau | Ce que fait le client |
|---|---|
| Messenger | « Connecter avec Facebook » → se connecte → coche sa page → c'est fini |
| Instagram | Pareil ; le compte Instagram doit être **professionnel** et **relié à sa page Facebook** |
| WhatsApp | « Connecter avec Facebook » → choisit ou crée son compte WhatsApp Business et son numéro |
| Telegram | Crée un bot avec @BotFather (1 minute) et colle le code donné |
| Chat web | Rien : le lien est déjà prêt |

Les jetons renvoyés par Meta et Telegram sont **chiffrés** (AES-256-GCM) dans
`BOT_DATA_DIR/channels-vault.json`. Chaque compte ne peut appartenir qu'à une seule entreprise.

## Étape 1 — Mettre le serveur en ligne en HTTPS

Meta et Telegram doivent pouvoir joindre votre serveur. Hébergez-le (Railway, un VPS…)
avec une adresse `https://`, puis renseignez :

```
PUBLIC_URL=https://votre-domaine.com
```

Gardez un **volume persistant** pour `BOT_DATA_DIR` : il contient les entreprises,
les conversations et le coffre des réseaux.

## Étape 2 — Créer l'application Meta

1. Sur [developers.facebook.com](https://developers.facebook.com), créez une application de type **Entreprise**.
2. Ajoutez les produits **Messenger**, **Instagram** (API Messenger pour Instagram), **WhatsApp** et **Facebook Login for Business**.
3. Dans *Facebook Login for Business > Paramètres*, ajoutez l'URL de redirection :
   `https://votre-domaine.com/oauth/meta/callback`
4. Dans *Paramètres > Général*, notez l'**ID de l'application** et la **clé secrète**.

```
META_APP_ID=…
META_APP_SECRET=…
META_VERIFY_TOKEN=une-phrase-secrete-de-votre-choix
```

## Étape 3 — Déclarer les webhooks (adresses de réception des messages)

Dans l'application Meta, pour chaque produit, renseignez l'URL de rappel et le jeton de vérification
(`META_VERIFY_TOKEN`) :

| Produit | URL de rappel | Champs à cocher |
|---|---|---|
| Messenger (Page) | `https://votre-domaine.com/webhook/messenger` | `messages`, `messaging_postbacks` |
| Instagram | `https://votre-domaine.com/webhook/instagram` | `messages` |
| WhatsApp | `https://votre-domaine.com/webhook/whatsapp` | `messages` |

L'abonnement de chaque page ou numéro de client est ensuite fait **automatiquement**
par la plateforme au moment où le client se connecte.

## Étape 4 — WhatsApp « Embedded Signup » (recommandé)

Pour que vos clients puissent créer leur compte WhatsApp Business directement dans la fenêtre Meta :

1. Devenez **Tech Provider** (Fournisseur de technologie) dans l'application Meta.
2. Dans *Facebook Login for Business > Configurations*, créez une configuration
   « WhatsApp Embedded Signup » avec les autorisations
   `whatsapp_business_management` et `whatsapp_business_messaging`.
3. Copiez son identifiant :

```
META_WHATSAPP_CONFIG_ID=…
```

Sans cette variable, la connexion WhatsApp fonctionne aussi, mais le client doit déjà avoir
un compte WhatsApp Business et un numéro enregistrés dans son Business Manager.

> Un numéro neuf doit encore être **enregistré** auprès de WhatsApp (code PIN à deux étapes).
> La fenêtre Embedded Signup s'en charge ; sinon le client le fait dans le gestionnaire WhatsApp de Meta.

## Étape 5 — Faire valider l'application par Meta (App Review)

Tant que l'application est en **mode développement**, seuls les comptes ajoutés comme testeurs
peuvent se connecter. Pour vos clients, demandez l'**accès avancé** à ces autorisations :

- `pages_show_list`, `pages_messaging`, `pages_manage_metadata`
- `instagram_basic`, `instagram_manage_messages`
- `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`

Meta demande : la **vérification de votre entreprise**, une **politique de confidentialité**
publique, et une **vidéo** montrant le parcours (connexion d'une page, message reçu, réponse).
Comptez de quelques jours à quelques semaines.

## Étape 6 — Vérifier

1. Redémarrez le serveur.
2. Ouvrez l'espace d'une entreprise > **Réseaux** : les boutons « Connecter avec Facebook » sont actifs.
3. Connectez une page de test, envoyez-lui un message depuis un autre compte :
   la réponse de l'assistant arrive et la conversation apparaît dans **Conversations**.

## Clé de chiffrement

Par défaut, une clé est créée dans `BOT_DATA_DIR/vault.key`. En production, préférez une variable :

```
CHANNEL_ENCRYPTION_KEY=<64 caractères hexadécimaux>
```

Générez-la avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
**Ne la perdez pas** : sans elle, toutes les entreprises devraient reconnecter leurs réseaux.
