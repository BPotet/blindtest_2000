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
- **Joueurs** (mobile) : rejoignent avec un code + un pseudo, répondent au QCM (le
  premier tap verrouille la réponse), voient s'ils ont eu bon/faux, les points
  gagnés et leur place au classement.
- **Scoring serveur infalsifiable** : les points (base + bonus de vitesse) sont
  calculés **uniquement à partir d'horodatages serveur** — aucune valeur envoyée
  par le client n'est utilisée.
- **Salles isolées** : plusieurs parties tournent en parallèle sans jamais se voir.
- **Nombre de joueurs illimité** : aucune limite artificielle.
- **Reconnexion** : recharger la page ou perdre le réseau ne fait pas perdre son
  score ni sa place.
- **Quiz de démonstration** livrés d'origine + **création de ses propres quiz**
  depuis l'interface.

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
  isolation de deux salles simultanées).

---

## 🧭 Périmètre de cette v1

Cette version vise **la boucle de jeu complète, déployable et testable tout de
suite**. Choix assumés pour y arriver vite et de façon fiable :

| Sujet | Choix v1 | Évolution prévue |
|---|---|---|
| **Lecture des extraits** | Lecteur **YouTube embarqué** sur l'écran de l'hôte (seek + play sur l'extrait). Pas d'extraction de fichier audio. | Extraction serveur (yt-dlp/ffmpeg) + stockage R2, en secours l'upload manuel — comme prévu dans les specs. |
| **Stockage** | Playlists **persistées dans PostgreSQL** si `DATABASE_URL` est défini (sinon en mémoire). L'état des parties en cours reste en mémoire (une partie est éphémère). | Idem + comptes hôte ; migrations Drizzle. |
| **Comptes hôte** | Pas d'authentification — on lance une partie directement. | `better-auth` (comptes hôte, connexion) tel que spécifié. |
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
  *.test.ts             # tests unitaires + intégration (vitest)
public/
  index.html            # écran hôte      join.html  # écran joueur (mobile)
  css/styles.css        # thème + composants
  js/host.js  js/player.js  js/common.js
Dockerfile  render.yaml  # déploiement
```

---

## 🎮 Déroulé d'une partie

1. L'hôte ouvre <http://localhost:3000>, choisit un quiz, clique **Ouvrir une salle**.
2. Les joueurs scannent le QR (ou vont sur `/join` et tapent le code) + un pseudo.
3. L'hôte clique **Démarrer la partie** ; à chaque manche l'extrait joue sur son
   écran, les joueurs voient le QCM et répondent (1er tap = verrouillé).
4. L'hôte **révèle** (ou le minuteur de la manche s'en charge) : chacun voit son
   résultat et le classement se met à jour.
5. **Manche suivante** jusqu'à la fin, puis **classement final**.
