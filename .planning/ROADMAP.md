# Roadmap: Blindtest 2000

## Overview

Blindtest 2000 se construit comme trois tranches verticales, chacune livrant une capacité complète et testable de bout en bout plutôt qu'une couche technique isolée. On part de la création de contenu (un hôte peut fabriquer un quiz réel, avec de vrais clips extraits de YouTube ou uploadés en secours) ; puis on ajoute la salle de jeu (des joueurs peuvent rejoindre une partie isolée depuis leur téléphone, jusqu'à ce que l'hôte démarre) ; enfin on connecte le tout dans le déroulé de partie réel (manches pilotées par l'hôte, scoring serveur infalsifiable, classement, reconnexion). Chaque phase est jouable/vérifiable seule ; la phase 3 assemble les deux précédentes en l'expérience blindtest complète.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Comptes hôte & création de quiz** - Un hôte crée un compte et fabrique un quiz complet avec de vrais clips YouTube extraits (ou uploadés en secours) et des QCM
- [ ] **Phase 2: Salle de jeu & arrivée des joueurs** - Un hôte ouvre une salle pour un de ses quiz ; un nombre illimité de joueurs rejoint depuis son mobile via QR/code, chaque salle restant isolée
- [ ] **Phase 3: Déroulé de partie, scoring & fiabilité** - L'hôte pilote chaque manche à son rythme avec de vrais clips ; scoring serveur infalsifiable, classement entre manches, reconnexion sans perte de score

## Phase Details

### Phase 1: Comptes hôte & création de quiz
**Goal**: Un hôte peut créer un compte, se connecter, et utiliser l'interface de création de quiz pour fabriquer un quiz complet avec de vrais clips audio extraits automatiquement de YouTube (ou uploadés manuellement en secours) et des QCM.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, QUIZ-01, QUIZ-02, QUIZ-03, QUIZ-04
**Success Criteria** (what must be TRUE):
  1. Un hôte peut créer un compte et se reconnecter lors d'une visite ultérieure.
  2. Sur la page de création de quiz, un hôte ajoute une question en collant une URL YouTube et un timestamp de départ ; l'app extrait automatiquement et restitue un clip de 30 secondes.
  3. L'hôte peut prévisualiser/écouter le clip extrait et re-couper le timestamp depuis le même écran si le découpage est mauvais, avant de valider la question.
  4. Quand l'extraction échoue, l'app détecte l'échec automatiquement et affiche un formulaire d'upload pour que l'hôte attache un fichier audio à la place.
  5. Pour chaque question, l'hôte remplit un formulaire avec la bonne réponse et un ou plusieurs leurres pour constituer le QCM.
**Plans**: TBD
**UI hint**: yes

### Phase 2: Salle de jeu & arrivée des joueurs
**Goal**: Un hôte peut ouvrir un écran de salle de jeu pour un de ses quiz, et un nombre illimité de joueurs peut rejoindre instantanément depuis une page mobile en indiquant seulement un pseudo, chaque salle restant totalement isolée des autres parties simultanées.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: AUTH-02, ROOM-01, ROOM-02, ROOM-03, ROOM-04, ROOM-05
**Success Criteria** (what must be TRUE):
  1. Un hôte peut créer une salle à partir d'un de ses quiz et voir un écran affichant à la fois un QR code et un code texte.
  2. Un joueur peut rejoindre la salle depuis une page mobile en scannant le QR code ou en saisissant le code texte, en donnant uniquement un pseudo (pas de compte).
  3. Les joueurs continuent d'apparaître sur l'écran de lobby de l'hôte au fur et à mesure qu'ils rejoignent, jusqu'à ce que l'hôte lance la première manche ; ensuite la liste se verrouille.
  4. Deux hôtes qui font tourner deux salles différentes en même temps ne voient jamais les joueurs, l'état ou les événements de l'autre sur leurs écrans.
  5. Une salle accepte un nombre de joueurs arbitrairement grand sans jamais atteindre une limite artificielle.
**Plans**: TBD
**UI hint**: yes

### Phase 3: Déroulé de partie, scoring & fiabilité
**Goal**: Un hôte peut faire tourner un blindtest complet à son propre rythme depuis son écran, avec de vrais clips, pendant que les joueurs répondent sur la vue de jeu de leur téléphone, pour une expérience compétitive juste, infalsifiable et toujours récupérable.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: GAME-01, GAME-02, GAME-03, GAME-04, SCORE-01, SCORE-02, RELY-01
**Success Criteria** (what must be TRUE):
  1. L'hôte lance chaque manche manuellement depuis son écran quand il le souhaite — aucun minuteur automatique n'impose la manche suivante.
  2. Quand une manche démarre, le clip joue sur l'appareil de l'hôte avec un minuteur visible correspondant à sa durée, et la vue de jeu de chaque joueur affiche des boutons de QCM qui se verrouillent dès le premier tap.
  3. Immédiatement après chaque manche, l'écran du joueur indique s'il a eu bon ou faux et les points gagnés, calculés uniquement à partir d'horodatages serveur de vitesse et d'exactitude.
  4. Entre les manches, une vue de classement partagée classe tous les joueurs par score, sur l'écran de l'hôte comme sur celui des joueurs.
  5. Un joueur qui perd sa connexion ou recharge la page peut se reconnecter et reprendre sur le même écran avec son score intact.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Comptes hôte & création de quiz | 0/TBD | Not started | - |
| 2. Salle de jeu & arrivée des joueurs | 0/TBD | Not started | - |
| 3. Déroulé de partie, scoring & fiabilité | 0/TBD | Not started | - |
