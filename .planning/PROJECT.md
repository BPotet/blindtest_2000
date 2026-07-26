# Blindtest 2000

## What This Is

Blindtest 2000 est une application web façon Kahoot, dédiée aux blindtests musicaux : les joueurs rejoignent une partie en scannant un QR code depuis leur téléphone, et l'hôte lance chaque manche quand il le souhaite. Une manche fait jouer un extrait audio précis de 30 secondes — extrait automatiquement d'une vidéo YouTube (URL + timestamp de départ), ou uploadé manuellement si l'extraction échoue — et les joueurs répondent à un QCM sur mobile.

## Core Value

Permettre à n'importe quel hôte de lancer un blindtest musical avec un nombre de joueurs illimité et ses propres extraits audio, sans les restrictions freemium de Kahoot (limite de joueurs, impossibilité d'importer de l'audio librement).

## Business Context

- **Customer**: Hôtes qui organisent des soirées blindtest — pas seulement l'auteur, ouvert à d'autres utilisateurs créant leur compte.
- **Revenue model**: Aucun pour l'instant — service gratuit, pas de plan de monétisation défini.
- **Success metric**: Non défini — à préciser une fois le service utilisé par d'autres que l'auteur.
- **Strategy notes**: —

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Créer un compte hôte et se connecter
- [ ] Créer un quiz : ajouter des questions à partir d'une URL YouTube + timestamp de départ, avec extraction automatique d'un clip de 30s
- [ ] Fallback : upload manuel d'un fichier audio quand l'extraction YouTube échoue, détecté et proposé automatiquement par l'app
- [ ] Pour chaque question, l'hôte saisit manuellement la bonne réponse et les leurres (QCM)
- [ ] Créer une salle de jeu avec un QR code / code de partie que les joueurs scannent pour rejoindre depuis leur téléphone
- [ ] L'hôte contrôle le rythme : il lance chaque manche quand il veut, aucun minuteur imposé entre les manches
- [ ] Côté joueur : entendre l'extrait diffusé par l'hôte et répondre au QCM sur son propre mobile
- [ ] Scoring façon Kahoot : points basés sur rapidité + exactitude, classement affiché entre les manches
- [ ] Aucune limite artificielle de joueurs par partie

### Out of Scope

- Mode buzzer / réponse orale — QCM mobile choisi comme mécanique de réponse v1
- Génération automatique des leurres du QCM — l'hôte les écrit lui-même en v1
- Extraction audio en direct pendant la partie — les clips sont préparés et testés à l'avance à la création du quiz, plus fiable que d'extraire en plein jeu
- Monétisation / plans payants — pas décidé, à revisiter si le service grandit

## Context

- Domaine comparable : jeux multijoueurs temps réel type Kahoot / Jackbox — host écran partagé + joueurs sur mobile.
- Le choix d'un "petit service ouvert à d'autres" (pas un usage strictement personnel) implique plusieurs parties simultanées possibles → nécessite un mécanisme de salles/rooms isolées, probablement en temps réel (websockets ou équivalent).
- L'extraction audio YouTube dépend d'outils tiers (type yt-dlp + ffmpeg) sujets aux évolutions de l'API/CGU YouTube — le fallback upload existe précisément pour absorber ces échecs.
- Stack technique non encore choisie ; à déterminer via la recherche de domaine avant la définition des requirements détaillées et de la roadmap.

## Constraints

- **Fiabilité extraction**: L'extraction YouTube n'est pas garantie à 100% (vidéo privée, géo-restreinte, retirée) — le fallback upload manuel est une exigence v1, pas une amélioration optionnelle.
- **Multi-parties simultanées**: Le service devant accueillir plusieurs hôtes/parties en parallèle, l'architecture doit isoler l'état de chaque partie (pas d'hypothèse d'instance unique).
- **Tech stack**: Non fixée — à choisir après recherche du domaine (voir étape recherche de `/gsd-new-project`).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| QCM mobile comme mécanique de réponse (pas buzzer, pas texte libre) | Plus proche du confort Kahoot, plus simple à scorer automatiquement et en temps réel | — Pending |
| Extraction du clip YouTube à la création du quiz, jamais en direct | Fiabilité pendant la partie — un échec doit se régler avant la soirée, pas devant les joueurs | — Pending |
| Fallback upload déclenché automatiquement par l'app à l'échec d'extraction | Réduit la friction pour l'hôte, pas besoin de deviner à l'avance si un lien va marcher | — Pending |
| Service ouvert à plusieurs hôtes (comptes, pas juste usage perso) | L'utilisateur veut que d'autres personnes puissent aussi créer leurs comptes et héberger leurs propres parties | — Pending |
| Scoring vitesse + exactitude façon Kahoot | Reproduit la dynamique compétitive familière de Kahoot | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-26 after initialization*
