# Hébergement Messenger YE — 14 septembre 2026

Le relais Messenger dédié est déployé sur le projet Supabase BOT_MULTIPLATE8FORME (fcowwopbzkmjdyhqyufw), restauré et actif. Il est indépendant du projet des élèves.

État public : https://fcowwopbzkmjdyhqyufw.supabase.co/functions/v1/ye-messenger/health
Callback Meta : https://fcowwopbzkmjdyhqyufw.supabase.co/functions/v1/ye-messenger

## Vérifié
- Réponse IA réelle depuis l’hébergement, avec le contexte YE et le bon lien d’installation. Aucun envoi Messenger effectué.
- Signature HMAC obligatoire ; rejet des échos, autres pages et événements de plus de 23 heures.
- File en base, identifiant unique pour éviter les doublons, exclusion du traitement simultané d’un même visiteur.
- File reprise toutes les minutes lorsqu’il existe des messages en attente ; purge quotidienne après sept jours.
- Maximum 100 traitements par jour et trois par minute par visiteur, réponses limitées à 300 tokens.
- Administration privée ; secrets dans Supabase, copie locale sous .private (ne pas publier).
- Lecture des messages interdite aux rôles anon/authenticated. Contrôle Supabase : aucune alerte sécurité WARN restante ; information RLS sans politique attendue car seul le serveur accède à la table.

## Reste à connecter
La page 61594279100581 n’est PAS encore reliée. YE_BOT_ENABLED reste false.
Il manque YE_META_APP_SECRET et YE_META_PAGE_TOKEN issus d’une application Meta autorisée à gérer Messenger pour cette page. Le propriétaire doit valider les écrans officiels Meta. Ni un mot de passe Facebook ni l’URL de la page ne remplacent cette autorisation.

Après autorisation : vérifier avec Meta que le jeton correspond au bon identifiant de page ; inscrire le callback et le jeton de vérification de .private/META-CONNEXION.txt ; abonner l’application aux événements messages de cette page ; vérifier les permissions de production/revue Meta nécessaires aux visiteurs hors équipe de test ; activer YE_BOT_ENABLED et faire un échange réel de bout en bout. Ces étapes ne sont pas encore accomplies.

## Exploitation
Arrêt : définir YE_BOT_ENABLED=false dans les secrets Supabase.
État technique détaillé : /admin/status avec Bearer YE_BOT_ADMIN_TOKEN ; ne pas mettre ce jeton dans une URL.
Test IA privé : POST /admin/test ; consomme un peu de crédit DeepSeek sans envoyer sur Messenger.
Les envois ambigus et erreurs passent en review/failed : pas de relance aveugle risquant un doublon. Le responsable technique doit examiner ces états. Le bot oriente une demande humaine vers contactye@proton.me ; aucune boîte de réception humaine intégrée n’a été déployée.

Ce déploiement couvre Messenger YE. Le tableau de bord Node reste local. WhatsApp, Instagram, TikTok et l’offre commerciale multi-entreprises ne sont pas activés par ce déploiement. Aucun accès aux conversations du WhatsApp personnel.

Le plan d’hébergement existant a été utilisé, aucun abonnement payant souscrit. La disponibilité dépend du plan et du maintien du projet actif ; l’offre gratuite ne doit pas être présentée comme une garantie de service 24 h/24. Le plafond de réponses limite les appels IA mais ne constitue pas un plafond de facture d’hébergement.

Sources techniques :
- https://supabase.com/docs/guides/functions/background-tasks
- https://supabase.com/docs/guides/functions/schedule-functions
