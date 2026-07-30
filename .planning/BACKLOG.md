# Backlog — Blindtest 2000

Idées à faire, priorisées. Légende :
**🟢 quick win** (peu d'effort, bon impact) · **🟡 moyen** · **🔴 gros chantier** · **💤 plus tard / à réévaluer**
🔥 = recommandé en priorité.

---

## ✅ Déjà livré (pour mémoire, ne pas refaire)
Salles + QR/code · solo & équipes · combo · mode auto · son sur les téléphones ·
écran public · contrôles hôte (rejouer=refaire la manche, pause, passer, exclure,
annuler) · import de playlist YouTube « surprise » · reconnexion · hôte mobile-friendly ·
révélation manuelle · votes en direct côté hôte · succès de manche (rapide/lente/au
buzzer/seul contre tous) + palmarès de fin (Éclair/Tranquille/Série/Sniper/Remontada) ·
démarrage résilient (deploy).

---

## 1. Gameplay & fun
- [ ] 🟢 **Plus de succès** : 🃏 Piège du jour (le mauvais choix le plus coché) · 💀 Lanterne rouge (bon dernier) · 🎪 L'Indécis (a le plus changé d'avis en équipe) · 🤝 Sans-faute collectif.
- [ ] 🟢 **Réactions emoji des joueurs** qui flottent sur l'écran public pendant la manche.
- [ ] 🟢 **Avatars / emoji au choix** à l'arrivée (perso joueur, façon Kahoot/Jackbox).
- [ ] 🟢 **Suggestions de pseudos rigolos** (« DJ Patate »…) sur l'écran de join.
- [ ] 🟡 **Ambiance de lobby** : petite boucle sonore synthétisée (Web Audio, pas de fichier) coupée au lancement.
- [ ] 🟡 **Manche bonus / double points** (aléatoire ou choisie par l'hôte).
- [ ] 🟢 **SFX en plus** : bip dans les 5 dernières secondes, roulement de tambour avant la révélation + **haptique** (vibration) au tap.
- [ ] 💤 **Mode buzzer** (« premier à répondre ») — vraie variante de jeu, gros changement d'interaction.
- [ ] 💤 **Indice progressif** (pochette floutée qui se révèle) — ne colle pas au format QCM synchrone, à réétudier.

## 2. Création de quiz & import
- [ ] 🔴🔥 **Extraction audio serveur** (yt-dlp + ffmpeg) → **stockage Cloudflare R2** + **upload manuel de secours**. C'est le grand « change futur » déjà prévu dans les specs : fiabilise la lecture (plus de dépendance au lecteur YouTube en direct) et coupe le risque « vidéo privée/géo-bloquée ».
- [ ] 🟡 **Re-cut serveur du timestamp** (réajuster le départ/durée d'un extrait déjà extrait).
- [ ] 🟢 **Dupliquer un quiz** + **tags/thèmes** pour s'y retrouver.
- [ ] 🟡 **Aperçu en lot** des extraits d'un quiz (vérifier tous les départs d'un coup).
- [ ] 🟡 **Assistant de leurres** : proposer 3 mauvaises réponses plausibles (toujours relues par l'hôte).
- [ ] 💤 **Import Spotify/Deezer** — OAuth + quotas + licences, à réserver à plus tard.

## 3. UX & mobile
- [ ] 🟢 **Bouton « copier le lien / le code »** sur le lobby hôte (partage rapide).
- [ ] 🟢 **Écran d'aide / onboarding hôte** (première partie : quoi faire, dans quel ordre).
- [ ] 🟡 **Accessibilité** : contrastes, focus visibles, aria-labels, navigation clavier.
- [ ] 🟢 **Toggle thème clair/sombre**.
- [ ] 🟡 **Passe mobile complète** sur les écrans restants (present, builder) après l'hôte.

## 4. Contrôles hôte
- [ ] 🟡 **Ajuster un score / bonus manuel** (corriger une erreur, récompenser un fair-play).
- [ ] 🟡 **Naviguer entre les manches** (rejouer une manche précise, revenir en arrière).
- [ ] 🟢 **Modération des pseudos** (denylist de gros mots, renommage forcé) — attendu sur un service « ouvert aux inconnus ».

## 5. Fiabilité, scale & ops
- [ ] 🔴 **Multi-instance** : adaptateur Redis Socket.IO + **persistance de l'état des salles** (survivre à un redémarrage / passer à l'échelle horizontale). Prévu dans la STACK, pas fait.
- [ ] 🟡 **Rate-limit élargi** : flood de `player:join` et de réponses, pas seulement l'auth.
- [ ] 🟢 **En-têtes de sécurité** (`helmet`).
- [ ] 🟡 **Monitoring / logs structurés** + health plus détaillé.

## 6. Qualité & dette technique (voir `.planning/CODE_REVIEW.md`)
- [ ] 🟡 **Découper `host.js`** (~1100 lignes) en modules ES — après avoir extrait/testé plus de logique pure (déjà commencé avec `quiz-form.js`).
- [ ] 🟢 **Découper `server.ts`** (http / sockets) — sûr car couvert par les tests.
- [ ] 🟢 **Regrouper les constantes de timing** (délais auto, grâce backstop…) dans un module `config`.
- [ ] 🟡 **Plus de tests de logique cliente** + e2e équipes/auto/import en CI.
- [ ] 🟢 **Lint** (ESLint + Prettier) dans la CI.

## 7. Déploiement / infra
- [ ] 🟢🔥 **Fiabiliser l'auto-deploy Render** : ajouter le secret `RENDER_DEPLOY_HOOK_URL` (le workflow est déjà là) **ou** réparer le webhook GitHub de Render.
