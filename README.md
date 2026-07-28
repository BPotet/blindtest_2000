# 🎵 Blindtest 2000

Application web de blindtest musical façon **Kahoot** : l'hôte lance une partie sur
son écran, les joueurs rejoignent depuis leur téléphone en scannant un QR code (ou
en tapant un code), et répondent à un QCM pour chaque extrait joué.

Cette version est une **première version jouable, déployable et testable de bout en
bout** — voir [Périmètre de cette v1](#-périmètre-de-cette-v1) pour ce qui est
inclus et ce qui viendra ensuite.

![Écran de l'hôte : code + QR + joueurs connectés](docs/screenshot-lobby.png)

---

## ✨ Ce que fait l'application

- **Hôte** (grand écran) : choisit un quiz, ouvre une salle (**code + QR code**),
  lance chaque manche à son rythme, l'extrait est joué via le lecteur YouTube
  embarqué sur son écran, puis la réponse est révélée avec le classement.
- **Écran public à projeter / partager** : un second écran (bouton **🖥️ Écran
  public**) affiche le code, le QR, le minuteur, la question, les propositions et
  le classement — **mais jamais la vidéo YouTube**. Les **propositions n'y
  apparaissent qu'au démarrage réel du morceau** (pas de spoiler pendant le
  chargement). L'hôte garde sa fenêtre de contrôle (avec la vidéo) sur son écran
  privé et projette / partage l'écran public, pour ne **pas dévoiler le morceau**
  avant la réponse. Les deux fenêtres se synchronisent en direct (même
  navigateur, via `BroadcastChannel`).
- **Configuration à l'ouverture de la salle** : cliquer *Ouvrir une salle* ouvre
  une **modale** récapitulant et laissant régler le mode (Individuel/Équipes), le
  combo, la partie automatique et son délai, et le **son sur les téléphones** —
  pour lancer en connaissance de cause.
- **Son sur le téléphone des joueurs** (option) : si l'hôte l'active, chaque
  joueur peut **écouter l'extrait sur son propre téléphone** (bouton *Écouter* —
  l'autoplay mobile exige un tap). Idéal pour jouer **à distance** ; en présentiel,
  l'hôte coupe le son de son écran pour éviter l'écho. La vidéo reste **masquée**
  (audio seul). Désactivé par défaut : sans cette option, aucun identifiant vidéo
  n'est envoyé aux joueurs (pas de spoiler possible).
- **Aperçu des extraits dans le constructeur** : un bouton **▶️ Aperçu** par
  manche joue l'extrait au bon timestamp, pour se rappeler quel est le morceau.
- **Joueurs** (mobile) : rejoignent avec un code + un pseudo, répondent au QCM (le
  premier tap verrouille la réponse), voient s'ils ont eu bon/faux, les points
  gagnés et leur place au classement.
- **Mode Individuel ou Équipes** (au choix de l'hôte) : en mode équipes, chaque
  joueur est sur **son propre téléphone** mais rattaché à une équipe (rejointe ou
  créée à la volée). Le sélecteur d'équipe se **met à jour en direct** : les
  équipes créées en parallèle sur d'autres téléphones apparaissent sans recharger.
  L'équipe **vote ensemble** (tally en direct, vote modifiable) ;
  **un membre verrouille** la réponse quand l'équipe est d'accord (la plus votée).
  Si le timer se termine sans verrouillage, la **plus votée** est retenue
  (départage : la première option votée). Score **commun** ; classement/podium par équipe.
- **Scoring serveur infalsifiable** : les points (base + bonus de vitesse) sont
  calculés **uniquement à partir d'horodatages serveur** — aucune valeur envoyée
  par le client n'est utilisée.
- **Salles isolées** : plusieurs parties tournent en parallèle sans jamais se voir.
- **Nombre de joueurs illimité** : aucune limite artificielle.
- **Reconnexion** : recharger la page ou perdre le réseau ne fait pas perdre son
  score ni sa place.
- **Comptes hôte multiples** : chaque organisateur **crée son compte** et gère
  **ses propres playlists**, invisibles des autres hôtes (les démos restent
  communes). Voir [Comptes hôte](#-comptes-hôte-plusieurs-organisateurs).
- **Quiz de démonstration** livrés d'origine + **création, édition et
  suppression** de ses propres playlists depuis l'interface.
- **Import d'une playlist YouTube** : colle le lien d'une playlist **thématique**,
  et l'app fabrique **un QCM par morceau** — la bonne réponse est le titre, les
  mauvaises sont d'autres titres de la playlist (donc plausibles et dans le
  thème). Mode **« surprise »** : le blindtest est créé **sans que l'hôte voie
  les morceaux** — il les découvre en jouant, comme les joueurs (ou mode
  **relecture** pour tout vérifier). Nécessite une clé API YouTube (voir
  [Import de playlist](#-import-de-playlist-youtube)).
- **Partie automatique (l'hôte joue aussi)** : mode au choix à l'ouverture de la
  salle. L'écran de l'hôte devient le **grand écran** — la **vidéo est masquée**
  (audio seul, visualiseur animé) pour ne pas dévoiler le morceau — et la partie
  **s'enchaîne toute seule** (révélation automatique, manche suivante automatique,
  podium final). Le **délai d'attente entre les manches est réglable** (2–30 s), et
  pendant l'attente **les joueurs voient le décompte** avant la chanson suivante
  (« ⏭️ Prochaine chanson dans 5… »). Dès que **tout le monde a répondu**, la
  manche se **révèle après 3 s** sans attendre la fin du minuteur. Une partie peut
  être **annulée** à tout
  moment (bouton *Annuler la partie*) pour revenir au lobby (scores remis à zéro).
  L'hôte **rejoint sur son téléphone** comme un joueur : il ne
  connaît pas les réponses et **joue à égalité** avec les autres. Un seul clic
  **Démarrer** au début (nécessaire pour l'audio), puis plus rien à toucher.
- **Bonus de série (combo)** : points bonus croissants pour les bonnes réponses
  consécutives (+100 par palier, plafonné à +500), **activable/désactivable par
  l'hôte** à l'ouverture de la salle.
- **Contrôles hôte** pendant la partie : **rejouer** l'extrait, **pause/reprise**
  (chrono gelé équitablement), **passer** une manche (sans la noter), et
  **exclure** un joueur depuis le lobby.
- **Récap de fin de manche** : répartition des votes par proposition (façon
  Kahoot) et nombre de joueurs ayant trouvé.
- **Minuteur visible** côté hôte **et** côté joueur (compte à rebours + barre).

---

## 🚀 Lancer en local (le plus simple)

Prérequis : **Node.js ≥ 20** (testé sur Node 22).

```bash
npm install
npm start
```

Puis ouvre :

- **Écran de l'hôte** : <http://localhost:3000>
- **Écran joueur** : <http://localhost:3000/join> (ou scanne le QR affiché par l'hôte)

Pour tester seul sur une seule machine : ouvre l'hôte dans un onglet, crée une
salle, puis ouvre `/join` dans un autre onglet (ou sur ton téléphone connecté au
même réseau, via l'URL affichée).

En développement avec rechargement automatique : `npm run dev`.

---

## ☁️ Déployer sur Render (un seul service)

Le dépôt contient un **`render.yaml`** (Blueprint) prêt à l'emploi.

1. Pousse ce dépôt sur GitHub (déjà le cas).
2. Sur [Render](https://render.com) : **New ➜ Blueprint**, sélectionne ce dépôt et
   la branche. Render lit `render.yaml` et crée un service web gratuit.
3. Render exécute `npm ci` puis `npm start`, et surveille `/api/health`.
4. Une fois déployé, l'URL publique de Render sert **à la fois** l'écran hôte et
   l'écran joueur. Le QR code utilise automatiquement `RENDER_EXTERNAL_URL`, donc
   les joueurs peuvent scanner et rejoindre depuis n'importe où.

> Alternative Docker : un `Dockerfile` autonome est fourni. Pour l'utiliser sur
> Render, remplace `runtime: node` par `runtime: docker` dans `render.yaml`, ou
> lance localement `docker build -t blindtest . && docker run -p 3000:3000 blindtest`.

Aucune base de données ni service externe n'est nécessaire pour cette v1.

---

## 🔐 Comptes hôte (plusieurs organisateurs)

L'écran de l'hôte est protégé par un **login + mot de passe**. Chaque hôte peut
**créer son propre compte** depuis l'écran de connexion (onglet **« Créer un
compte »**) : les playlists qu'il crée sont **rattachées à son compte** et ne
sont visibles que par lui — les quiz de **démo** restent visibles par tous.
Plusieurs hôtes cohabitent donc, chacun avec ses propres playlists. Les joueurs,
eux, rejoignent **sans compte**.

Un compte **admin** de départ est aussi (ré)appliqué à chaque démarrage depuis
l'environnement (pratique comme premier accès) :

| Variable | Rôle | Défaut |
|---|---|---|
| `ADMIN_USERNAME` | Identifiant du compte de départ | `admin` |
| `ADMIN_PASSWORD` | Mot de passe du compte de départ (haché avec scrypt) | `admin` ⚠️ à changer |
| `SESSION_SECRET` | Secret de signature des sessions (cookie) | aléatoire par démarrage |

> Sur Render : **Environment** → ajoute `ADMIN_PASSWORD` et `SESSION_SECRET`
> (chaîne aléatoire longue et stable, sinon tout le monde est déconnecté à chaque
> redéploiement). Le compte admin est (ré)appliqué à chaque démarrage.
>
> 💾 **Pour du multi-comptes durable, définis `DATABASE_URL`** (PostgreSQL, p. ex.
> [Neon](https://neon.tech)) : les comptes créés et leurs playlists sont alors
> conservés entre les redémarrages. Sans base, les comptes créés vivent en
> mémoire et repartent à zéro au redémarrage (seul le compte admin de
> l'environnement revient).

## 📥 Import de playlist YouTube

Depuis l'écran d'accueil de l'hôte, **« 📥 Importer une playlist YouTube »** :
colle le lien d'une playlist **thématique**, choisis le nombre de morceaux, le
point de départ et la durée. L'app :

1. récupère les **titres** de la playlist (jusqu'à 200) via l'API officielle
   **YouTube Data API v3** (métadonnées seulement — aucune extraction/téléchargement) ;
2. nettoie les titres (retire « (Official Video) », « [Remastered] »…) ;
3. **tire au sort** les morceaux joués (sélection **et** ordre aléatoires) parmi
   toute la playlist, puis crée **une manche par morceau** avec un QCM : bonne
   réponse = le titre, mauvaises réponses = **3 autres titres tirés de toute la
   playlist importée** (pas seulement des morceaux joués), à des positions
   mélangées.

Deux boutons, selon que l'hôte veut ou non connaître le contenu :

- **🎲 Générer en surprise** — le blindtest est **créé et enregistré directement,
  sans jamais afficher les morceaux à l'hôte**. Il ne connaît ni les questions ni
  les réponses : il **découvre le blindtest en jouant**, comme les joueurs.
- **👁️ Générer et relire** — pré-remplit le **constructeur** pour **vérifier et
  ajuster** (départs, titres, ordre) avant d'enregistrer. L'hôte voit alors les
  réponses.

Cette fonction n'apparaît que si une **clé API YouTube** est configurée :

| Variable | Rôle |
|---|---|
| `YOUTUBE_API_KEY` | Clé de l'API YouTube Data v3 (gratuite, quota large) |

**Obtenir la clé (une fois, ~5 min)** : [Google Cloud Console](https://console.cloud.google.com/)
→ crée un projet → **APIs & Services → Library** → active **YouTube Data API
v3** → **Credentials → Create credentials → API key** → copie la clé. Sur Render :
**Environment** → ajoute `YOUTUBE_API_KEY`. (Sans clé, tout le reste fonctionne ;
seul l'import est masqué.)

> La playlist doit être **publique ou non répertoriée** (pas privée). L'appel ne
> fait que **lire la liste des vidéos** : rien n'est téléchargé.

## 🧪 Tests

Pyramide de tests (rapide, sans dépendance externe) :

```bash
npm test          # unitaires (scoring, codes, YouTube, moteur de salle) + intégration (flux Socket.IO complet)
npm run typecheck # vérification TypeScript
```

- **Unitaires** : logique de scoring, génération de codes non ambigus, parsing des
  liens YouTube, moteur de partie (lobby, verrouillage au 1er tap, scoring
  cumulé, reconnexion, isolation des salles).
- **Intégration** : une partie complète jouée via de vrais clients Socket.IO
  (création de salle, arrivée de 2 joueurs, réponses, scoring serveur, classement,
  isolation de deux salles simultanées), l'authentification hôte et le CRUD des
  playlists (HTTP).
- **Charge** : `src/load.test.ts` fait jouer **40 joueurs simultanés** sur une
  manche complète et vérifie le classement.
- **e2e multi-navigateurs** (`e2e/`, Playwright) : une partie complète (login →
  salle → un joueur → réponse → résultat) rejouée sur **Chromium (Chrome/Opera/
  Edge), Firefox (Gecko) et WebKit (Safari)**. Le serveur est démarré
  automatiquement et YouTube est neutralisé pour un test déterministe.

```bash
npm run test:e2e                 # les 3 navigateurs (nécessite « npx playwright install »)
npm run test:e2e -- --project=chromium   # un seul navigateur
```

> Les 3 navigateurs tournent **à chaque push via GitHub Actions**
> (`.github/workflows/e2e.yml`) — c'est là que Firefox et WebKit s'installent et
> s'exécutent réellement.

### Test de charge sur une instance en ligne

Un script autonome simule N joueurs sur n'importe quelle URL (local ou Render) :

```bash
node scripts/loadtest.mjs http://localhost:3000 40
node scripts/loadtest.mjs https://blindtest-2000.onrender.com 50
# Identifiants hôte via ADMIN_USERNAME / ADMIN_PASSWORD (défaut admin/admin)
```

Il ouvre une salle, y connecte N joueurs, joue une manche et affiche les
latences (min / moyenne / p95 / max) et le temps total.

---

## 🧭 Périmètre de cette v1

Cette version vise **la boucle de jeu complète, déployable et testable tout de
suite**. Choix assumés pour y arriver vite et de façon fiable :

| Sujet | Choix v1 | Évolution prévue |
|---|---|---|
| **Lecture des extraits** | Lecteur **YouTube embarqué** sur l'écran de l'hôte (seek + play sur l'extrait). Pas d'extraction de fichier audio. | Extraction serveur (yt-dlp/ffmpeg) + stockage R2, en secours l'upload manuel — comme prévu dans les specs. |
| **Stockage** | Playlists **persistées dans PostgreSQL** si `DATABASE_URL` est défini (sinon en mémoire). L'état des parties en cours reste en mémoire (une partie est éphémère). | Idem + comptes hôte ; migrations Drizzle. |
| **Comptes hôte** | **Inscription libre multi-comptes** (chaque hôte crée le sien) + compte `admin` de départ via variables d'env ; mots de passe hachés (scrypt), sessions par cookie signé ; playlists **rattachées à chaque utilisateur**. | Réinitialisation de mot de passe, connexion sociale ; migration vers `better-auth`. |
| **Serveur** | Node + Express + Socket.IO, un seul service. | Fastify + adaptateur Redis Socket.IO pour le multi-instances. |

> 💾 **Persistance des playlists** : définis `DATABASE_URL` (PostgreSQL — p. ex.
> [Neon](https://neon.tech), gratuit) et les playlists créées sont conservées
> entre les redémarrages/redéploiements. Sans `DATABASE_URL`, le stockage est en
> mémoire (les quiz créés sont réinitialisés au redémarrage ; les 2 démos
> reviennent toujours). Si `DATABASE_URL` est défini mais la base est injoignable,
> l'app bascule automatiquement en mémoire et reste en ligne (message dans les logs).
> Dans tous les cas, une partie **en cours** vit en mémoire (c'est voulu : une
> partie est éphémère).

Le lecteur YouTube nécessite un accès à YouTube depuis le **navigateur de l'hôte**
(donc une connexion internet côté hôte). Si une vidéo est indisponible, la manche
se joue quand même : le QCM et le scoring fonctionnent, seule la lecture de
l'extrait est absente.

Les documents de conception complets restent dans `openspec/` (contrat de specs) et
`.planning/` (boucle d'implémentation GSD).

---

## 🗂️ Structure

```
src/
  index.ts              # point d'entrée (écoute HTTP)
  server.ts             # Express + Socket.IO, routes API, câblage des évènements
  types.ts              # contrat de types (manches, salles, classement…)
  validation.ts         # schémas zod pour toute entrée non fiable (joueurs/hôte)
  game/
    room.ts             # moteur de salle (état de partie, réponses, scoring, isolation)
    scoring.ts          # calcul des points serveur-autoritaire + classement
    codes.ts            # codes de salle courts non ambigus (nanoid)
    quizzes.ts          # quiz de démonstration
    store.ts            # stockage en mémoire des quiz
    youtube.ts          # extraction de l'ID vidéo depuis une URL/ID
    youtube-import.ts   # import de playlist YouTube -> brouillon de quiz (QCM auto)
  *.test.ts             # tests unitaires + intégration (vitest)
public/
  index.html            # écran hôte (contrôle + vidéo)   join.html  # écran joueur (mobile)
  present.html          # écran public à projeter/partager (sans vidéo)
  css/styles.css        # thème + composants
  js/host.js  js/player.js  js/present.js  js/common.js
Dockerfile  render.yaml  # déploiement
```

---

## 🎮 Déroulé d'une partie

1. L'hôte ouvre <http://localhost:3000>, choisit un quiz, clique **Ouvrir une salle**.
   Pour projeter sans dévoiler la vidéo : bouton **🖥️ Écran public** (nouvelle
   fenêtre `/present`) → mets **celle-ci** sur le vidéoprojecteur / en partage
   d'écran, et garde la fenêtre de contrôle (avec la vidéo) sur ton écran privé.
2. Les joueurs scannent le QR (ou vont sur `/join` et tapent le code) + un pseudo.
3. L'hôte clique **Démarrer la partie** ; à chaque manche l'extrait joue sur son
   écran, les joueurs voient le QCM et répondent (1er tap = verrouillé).
4. L'hôte **révèle** (ou le minuteur de la manche s'en charge) : chacun voit son
   résultat et le classement se met à jour.
5. **Manche suivante** jusqu'à la fin, puis **classement final**.
