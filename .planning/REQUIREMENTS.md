# Requirements: Blindtest 2000

**Defined:** 2026-07-26
**Core Value:** Permettre à n'importe quel hôte de lancer un blindtest musical avec un nombre de joueurs illimité et ses propres extraits audio, sans les restrictions freemium de Kahoot.

## v1 Requirements

Requirements pour le lancement initial. Chacune sera mappée à une phase de la roadmap.

### Auth (comptes hôte)

- [ ] **AUTH-01**: Un hôte peut créer un compte et se connecter
- [ ] **AUTH-02**: Les joueurs n'ont besoin d'aucun compte — ils rejoignent avec un simple pseudo

### Quiz Authoring (QUIZ)

- [ ] **QUIZ-01**: L'hôte crée un quiz et ajoute des questions à partir d'une URL YouTube + timestamp de départ ; l'app extrait automatiquement un clip de 30 secondes
- [ ] **QUIZ-02**: L'hôte peut prévisualiser/tester le clip extrait à la création (écouter, re-couper si le découpage est mauvais) avant de valider la question
- [ ] **QUIZ-03**: Si l'extraction YouTube échoue, l'app le détecte et propose automatiquement à l'hôte d'uploader un fichier audio à la place
- [ ] **QUIZ-04**: Pour chaque question, l'hôte saisit manuellement la bonne réponse et les leurres du QCM

### Salle de jeu (ROOM)

- [ ] **ROOM-01**: L'hôte crée une salle de jeu affichant un QR code ET un code texte (les deux, pas QR seul)
- [ ] **ROOM-02**: Les joueurs rejoignent en scannant le QR code ou en saisissant le code, avec juste un pseudo
- [ ] **ROOM-03**: Chaque salle a un état isolé — plusieurs parties simultanées de différents hôtes ne s'interfèrent jamais
- [ ] **ROOM-04**: Les joueurs peuvent rejoindre la salle jusqu'à ce que l'hôte lance la première manche
- [ ] **ROOM-05**: Aucune limite artificielle du nombre de joueurs par salle

### Déroulé de partie (GAME)

- [ ] **GAME-01**: L'hôte lance chaque manche manuellement, à son rythme — aucun minuteur automatique entre les manches
- [ ] **GAME-02**: Le clip audio joue sur l'appareil/les haut-parleurs de l'hôte, avec un minuteur visible correspondant à la durée du clip
- [ ] **GAME-03**: Chaque joueur répond au QCM sur son propre téléphone ; la réponse se verrouille dès le premier tap (pas de retour en arrière)
- [ ] **GAME-04**: Après chaque manche, le joueur voit immédiatement s'il a bon/faux et les points gagnés

### Scoring & Classement (SCORE)

- [ ] **SCORE-01**: Le scoring vitesse + exactitude est calculé côté serveur (le serveur horodate le début de manche et la réception de chaque réponse — jamais le temps déclaré par le client)
- [ ] **SCORE-02**: Un classement (leaderboard) s'affiche entre les manches

### Fiabilité joueur (RELY)

- [ ] **RELY-01**: Un joueur qui perd sa connexion ou recharge la page peut se reconnecter sans perdre son score (identité de joueur persistante, indépendante de la connexion websocket)

## v2 Requirements

Reconnues comme utiles mais différées après validation du produit de base.

### Modération & Confort hôte

- **MODR-01**: Filtre anti-pseudo offensant à l'entrée en salle
- **MODR-02**: L'hôte peut expulser un joueur en cours de lobby/partie
- **QUIZ-05**: Bibliothèque de quiz réutilisables entre plusieurs soirées pour un compte hôte
- **GAME-05**: Contrôles hôte additionnels (couper les effets sonores, afficher/masquer la réponse côté joueur)
- **QUIZ-06**: Assistant de suggestion de leurres (revu manuellement par l'hôte avant validation)

### Sourcing audio étendu

- **QUIZ-07**: Import de playlist depuis un service de streaming (Spotify/Deezer)

## Out of Scope

Exclu explicitement du produit. Reasoning inclus pour éviter toute réintroduction non discutée.

| Feature | Reason |
|---------|--------|
| Mode buzzer / réponse orale | Modèle d'interaction et de scoring entièrement différent (course au buzz + arbitrage oral) ; le v1 est QCM uniquement |
| Génération automatique des leurres (LLM/dataset) | De mauvais leurres cassent l'expérience plus qu'ils ne l'améliorent ; nécessite une source de données musicales curatée hors scope v1 |
| Extraction YouTube en direct pendant la partie | Un échec d'extraction en plein jeu est maximal en visibilité et irrécupérable devant les joueurs ; tous les clips sont préparés et testés à l'avance |
| Application mobile native pour les joueurs | Le "sans installation, juste un lien/QR" est l'avantage compétitif du genre (Kahoot, Jackbox, blindtest.gg) ; une app ajoute de la friction sans gain UX à ce rythme de jeu |
| Audio diffusé individuellement sur chaque téléphone | Casse le format "salle partagée" propre au blindtest et introduit des problèmes de synchronisation réseau entre N téléphones qui n'existent pas avec une seule source audio (l'hôte) |
| Monétisation / plans payants | Contraire à la raison d'être du projet (éviter les restrictions freemium de Kahoot) ; à revisiter uniquement si le coût d'hébergement du service gratuit devient intenable |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 2 | Pending |
| QUIZ-01 | Phase 1 | Pending |
| QUIZ-02 | Phase 1 | Pending |
| QUIZ-03 | Phase 1 | Pending |
| QUIZ-04 | Phase 1 | Pending |
| ROOM-01 | Phase 2 | Pending |
| ROOM-02 | Phase 2 | Pending |
| ROOM-03 | Phase 2 | Pending |
| ROOM-04 | Phase 2 | Pending |
| ROOM-05 | Phase 2 | Pending |
| GAME-01 | Phase 3 | Pending |
| GAME-02 | Phase 3 | Pending |
| GAME-03 | Phase 3 | Pending |
| GAME-04 | Phase 3 | Pending |
| SCORE-01 | Phase 3 | Pending |
| SCORE-02 | Phase 3 | Pending |
| RELY-01 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18/18 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-26*
*Last updated: 2026-07-26 after roadmap creation (traceability mapped to Phases 1-3)*
