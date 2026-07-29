# Specs courantes (état livré v1)

Ces specs décrivent l'**application réellement livrée** (v1). Elles ont été
écrites lors de la revue de code (`.planning/CODE_REVIEW.md`) pour réaligner
OpenSpec sur la réalité.

## Capacités

- **host-auth** — comptes hôte par identifiant (username), inscription libre
  multi-comptes, sessions par cookie signé, isolation des playlists.
- **quiz-authoring** — création/édition de playlists, manches via lecteur YouTube
  embarqué (pas d'extraction serveur en v1), QCM, aperçu, import de playlist.
- **gameplay** — salles, arrivée des joueurs, déroulé de manche, scoring
  serveur-autoritaire, combo, solo/équipes, contrôles hôte, mode automatique, son
  sur les téléphones, écran public, reconnexion.

## Rapport avec le change `phase-1-host-quiz-authoring`

Le change `openspec/changes/phase-1-host-quiz-authoring` est **partiellement
superseded** :

- Son volet **auth par e-mail** est remplacé par `host-auth` (auth par identifiant).
- Son volet **extraction serveur yt-dlp/ffmpeg + upload manuel** n'a pas été
  construit en v1 (choix assumé : lecteur YouTube embarqué). Il reste la **cible
  future** et devrait faire l'objet d'un **nouveau change** (« extraction audio +
  stockage R2 + upload de secours »), voir la section « Évolution future » de
  `quiz-authoring`.

Voir `.planning/CODE_REVIEW.md` pour la revue complète et la proposition de refactor.
