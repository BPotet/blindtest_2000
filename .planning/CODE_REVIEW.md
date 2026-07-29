# Revue de code — Blindtest 2000

_Revue complète du code au terme de la v1 (rooms, gameplay solo/équipes, combo,
mode auto, import YouTube, son sur les téléphones, écran public, comptes
multiples, e2e cross-navigateurs). ~4 750 lignes de code applicatif, 123 tests._

## Verdict

Base **saine et bien testée côté serveur**, avec de bons choix de fond (scoring
serveur-autoritaire, validation Zod systématique, abstraction du stockage,
dépendances vivantes). Deux angles morts à traiter en priorité :

1. **La logique de partie vit dans le navigateur de l'hôte** (le serveur ne fait
   tourner aucune horloge de manche). Si l'onglet de l'hôte se ferme en pleine
   manche, la partie se fige.
2. **Les specs OpenSpec ne décrivent plus l'application** (elles parlent d'une
   auth par e-mail et d'une extraction yt-dlp jamais construites ; tout le jeu
   n'a aucune spec).

Aucun bug bloquant en production sur le chemin nominal ; les points ci-dessous
sont surtout robustesse, maintenabilité et dette de specs.

---

## Points forts (à préserver)

- **Scoring infalsifiable** : les temps de réponse sont mesurés côté serveur
  (`room.ts` `submitAnswer`/`endRound`), jamais fournis par le client.
- **Validation systématique** de toute entrée non fiable via Zod (`validation.ts`),
  y compris les payloads Socket.IO.
- **Abstraction de stockage propre** : `QuizRepository` (mémoire/Postgres) avec
  repli automatique si la base est injoignable (`index.ts`).
- **Bonne pyramide de tests serveur** : 123 tests (unitaires + intégration
  Socket.IO + charge 40 joueurs) ; e2e Playwright multi-navigateurs en CI.
- **Sécurité par défaut** : son sur téléphones opt-in (l'ID vidéo n'est jamais
  envoyé aux joueurs sans activation), cookies HttpOnly/SameSite, scrypt.
- **Dépendances saines** : pas de `fluent-ffmpeg`/`ffmpeg-kit` (morts), Lucia
  évité, etc.

---

## Constats (par sévérité)

### 🔴 Élevé — architecture

**A1. La manche n'a pas d'horloge côté serveur ; l'hôte pilote le temps.**
Le minuteur, la révélation, la pause et l'auto-skip tournent dans `host.js` ; le
serveur ne clôt une manche que sur réception de `host:endRound` (`server.ts:517`).
Sur `disconnect` de l'hôte (`server.ts:765`), on met seulement `hostSocketId = null`
sans clore la manche en cours.
- **Impact** : si l'onglet hôte se ferme / se met en veille / perd le réseau en
  pleine manche, la manche ne se termine jamais → joueurs bloqués, salle figée
  jusqu'au `pruneStale` (idle). C'est aussi la cause racine de la fragilité des
  modes auto/audio (tout dépend d'un seul navigateur).
- **Correctif** : rendre le cycle de manche **serveur-autoritaire** (voir Refactor
  P1). `Room` détient déjà `roundStartedAt`, `durationSeconds`, l'état de pause —
  il ne manque que le `setTimeout`/`setInterval` côté serveur.

### 🟠 Moyen

**M1. Handlers Socket.IO `async` sans try/catch → rejet non géré.**
`host:createRoom` (`server.ts:407`) fait `await quizRepo.get(...)` sans capture.
En Postgres, une erreur transforme le handler en promesse rejetée non gérée.
- **Correctif** : un wrapper `onSafe(event, handler)` qui `try/catch` et émet une
  erreur propre au socket. Auditer tous les futurs handlers `async`.

**M2. Aucune limitation de débit sur `/api/login` et `/api/register`.**
Brute-force de mot de passe et spam d'inscriptions possibles (inscription ouverte).
- **Correctif** : limiteur en mémoire simple (par IP, fenêtre glissante) ou
  `express-rate-limit`. Couplé à l'option « inscription restreinte » du backlog.

**M3. Noms d'évènements Socket.IO en dur, dupliqués client/serveur (~30).**
Aucune source unique ; un typo casse silencieusement (on a déjà vécu la même
classe de bug avec `combo` absent du schéma). Le client vanilla ne peut pas
importer les types TS du serveur.
- **Correctif** : `public/js/events.js` (constantes partagées) + miroir TS, ou un
  petit paquet `shared/` de noms d'évènements. Réduit fortement le risque de
  désynchronisation client/serveur.

**M4. `host.js` = IIFE de 1 072 lignes, ~8 responsabilités.**
Auth, liste/CRUD de quiz, constructeur, import, modale de config, diffusion vers
l'écran public, contrôle de partie, minuteur. Difficile à tester et à faire
évoluer.
- **Correctif** : découper en modules ES (voir Refactor P2).

**M5. La logique cliente n'a aucun test unitaire.**
Le bug de `correctIndex` (propositions vides → « quiz invalide ») vivait dans
`host.js`, non couvert par les tests unitaires. `player.js`, `present.js`,
`common.js` idem. Seuls des smokes navigateur (hors CI) + 1 e2e couvrent le front.
- **Correctif** : extraire la logique pure du client (mapping des propositions,
  machine à états de l'écran public) en modules testables ; router les smokes
  existants vers la CI.

### 🟡 Bas

- **B1.** `server.ts` (816 l.) mélange routes HTTP et câblage Socket.IO dans une
  seule fonction. À scinder (`http/`, `sockets/`).
- **B2.** Parsing d'ID YouTube dupliqué : `src/game/youtube.ts` (serveur) et
  `host.js` `parseYtId` (client). Logique à garder synchronisée à la main.
- **B3.** Pas d'en-têtes de sécurité (`helmet`). SameSite=Lax couvre l'essentiel
  du CSRF ; à ajouter par hygiène.
- **B4.** `pruneStale` toutes les 15 min : une salle « playing » orpheline (hôte
  parti) survit jusqu'au timeout d'inactivité. Résolu de fait par A1.
- **B5.** Nombres magiques dispersés (repli extrait 12 s, `AUTO_SKIP_MS` 3 s,
  délai auto réglable) — la plupart documentés ; à regrouper dans une config.

### ℹ️ Limite assumée

- **Mono-instance** : salles en mémoire, pas d'adaptateur Redis Socket.IO. Le
  multi-parties fonctionne dans un process, mais ne passe pas à l'échelle
  horizontale et ne survit pas à un redémarrage. Prévu dans la STACK, non fait.

---

## Proposition de refactor (priorisée)

### P1 — Correctness/robustesse (recommandé en premier)

1. **Cycle de manche serveur-autoritaire.** Le serveur possède l'horloge :
   - `host:startRound` → serveur prépare la manche (déjà le cas).
   - `host:clipStarted` → serveur démarre un `setTimeout(durationSeconds)` et
     émet le vrai départ aux joueurs.
   - à l'expiration (ou sur `host:endRound` anticipé, ou auto-skip « tous ont
     répondu »), **le serveur** clôt la manche et émet `round:result`.
   - pause/reprise ajustent le timer côté serveur (comme aujourd'hui côté client).
   - **Bénéfices** : survit à la déconnexion de l'hôte, une seule source de vérité
     pour le temps, `host.js`/`player.js` simplifiés (plus de minuteur miroir).
2. **Wrapper `onSafe` pour les handlers `async`** + **rate-limit auth**.

### P2 — Maintenabilité

3. **Constantes d'évènements partagées** (`events.js` + miroir TS).
4. **Découper `host.js`** en modules ES (`type="module"` + imports) :
   `net.js` (socket + events), `auth.js`, `quizzes.js` (liste/CRUD),
   `builder.js`, `import.js`, `room-config.js`, `game.js`, `present-bridge.js`.
5. **Découper `server.ts`** : `http/routes.*.ts` + `sockets/host.ts` +
   `sockets/player.ts`, `buildServer` ne fait plus que le câblage.

### P3 — Qualité/couverture

6. **Extraire et tester** la logique cliente pure ; **exécuter les smokes en CI**
   (déjà 1 e2e ; ajouter les parcours équipes/auto/import).
7. Regrouper les constantes de timing dans un module `config`.

> Note : chaque étape est indépendante et livrable seule (commits atomiques).
> P1 change des évènements réseau → prévoir de rafraîchir client + serveur ensemble.

---

## Couverture de tests

| Zone | État |
|---|---|
| Scoring, codes, YouTube, moteur de salle, store, auth | ✅ unitaires solides |
| Flux Socket.IO complet, CRUD, équipes, import, audio, auto-next | ✅ intégration |
| Charge 40 joueurs | ✅ |
| e2e multi-navigateurs (Chromium/Firefox/WebKit) | ✅ CI (1 parcours) |
| **Logique cliente** (`host.js`, `player.js`, `present.js`) | ❌ pas d'unitaires |

Priorité : la logique cliente (là où sont passés nos derniers bugs).

---

## État des specs (OpenSpec) — réécriture nécessaire

`openspec/specs/` est **vide** : il n'existe que le change `phase-1-host-quiz-authoring`,
qui décrit une application **différente de celle livrée** :

| Spec phase-1 | Réalité livrée (v1) |
|---|---|
| Auth par **e-mail** + mot de passe | **Identifiant** (username) + mot de passe, multi-comptes |
| **Extraction serveur** yt-dlp/ffmpeg d'extraits 30 s sur disque | **Lecteur YouTube embarqué** (IFrame), aucune extraction |
| **Aperçu + re-cut** de l'extrait extrait | Aperçu simple (IFrame) ; pas de re-cut serveur |
| **Upload manuel** en secours d'extraction | Non implémenté |
| QCM (bonne réponse + leurres) | ✅ conforme |
| — (rien) | **Tout le jeu** : salles, join QR/code, solo/équipes, scoring+combo, mode auto, son sur téléphones, écran public, import de playlist |

**Proposition** :
1. Marquer le change `phase-1` comme **partiellement superseded** : l'extraction
   serveur + upload + R2 restent la **cible future** (documentée dans la STACK et
   le backlog), pas une régression.
2. Créer les specs **de l'état réel** dans `openspec/specs/` : `host-auth`
   (username/multi-comptes), `quiz-authoring` (IFrame + QCM + import),
   `game-rooms` et `gameplay` (déroulé, scoring, modes). Brouillons fournis dans
   ce commit.
3. Garder « extraction audio + R2 + upload » comme **change futur** explicite.

Les brouillons de specs corrigées sont dans `openspec/specs/` (ce commit).
