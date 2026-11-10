# Bot WhatsApp sur OPPO

## Correction de la reprise

Lors du contrôle suivant, Termux était vivant mais run.sh et Node étaient absents. Correctif whatsapp-reconnect transféré sans remplacer la session ni la file. Lancement via TermuxService sous l'identité Termux : run.sh est désormais un enfant du processus Android Termux (et non d'une commande USB). Le script Boot exécute directement run.sh afin que le service suive sa durée de vie. Statut connecté confirmé, deux messages traités et un en attente au premier contrôle. Ne pas lancer en parallèle l'ancienne session PC. La bascule PC/téléphone n'est pas implémentée ; le téléphone reste l'hôte unique.

Migration du 25 septembre 2026 : OPPO CPH2135, Android 11, connexion ADB autorisée. Termux et Termux:Boot officiels GitHub installés. Programme et dépendances installés dans /data/data/com.termux/files/home/ye-bot.

La session 237673676864 et la seule clé DeepSeek nécessaire ont été transférées directement par USB vers le stockage privé. PC arrêté ; raccourci Windows déplacé dans .private/YE WhatsApp PC sauvegarde.lnk. Ne jamais démarrer les deux copies avec cette session.

Termux : activité en arrière-plan et lancement automatique autorisés dans ColorOS ; exemptions deviceidle Termux et Boot appliquées. Verrou de veille Termux observé actif, écran Asleep. Connexion WhatsApp ready=true vérifiée via redirection USB 3192 -> 3191 et en-tête Host 127.0.0.1:3191.

Boot : ~/.termux/boot/10-ye-bot lance run.sh ; verrou flock anti-double instance ; reprise après sortie du processus. Le redémarrage réel du téléphone et une réponse WhatsApp de bout en bout restent à tester. Le téléphone doit rester connecté à Internet ; ne pas forcer l'arrêt de Termux.

Les groupes de cette session renvoient une liste vide. Aucune prospection de masse ni groupe ajouté automatiquement. Configuration de confidentialité technique renforcée sur la copie OPPO ; dernier ajout non déployé sur Facebook à ce stade.
