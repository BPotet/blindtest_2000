# quiz-authoring

_Spec de l'état livré (v1). Remplace le volet extraction du change
`phase-1-host-quiz-authoring` : la v1 **ne fait pas d'extraction serveur** ni
d'upload manuel — l'extrait est joué par le **lecteur YouTube embarqué** sur
l'écran de contrôle de l'hôte (choix assumé, voir README « Périmètre v1 »).
L'extraction yt-dlp/ffmpeg + stockage R2 + upload de secours restent une
**évolution future** (change à créer)._

## Requirements

### Requirement: Création et gestion de playlists
Un hôte connecté SHALL pouvoir créer, éditer et supprimer ses propres playlists
(titre + manches), et réordonner/supprimer les manches.

#### Scenario: Création d'une playlist
- **WHEN** un hôte enregistre une playlist avec un titre et au moins une manche valide
- **THEN** le système la crée, rattachée à son compte, et l'affiche dans sa liste

#### Scenario: Édition/suppression réservées au propriétaire
- **WHEN** un hôte tente de modifier/supprimer une playlist qui ne lui appartient
  pas, ou une démo
- **THEN** le système refuse (HTTP 404)

### Requirement: Manche depuis un lien YouTube (sans extraction)
Une manche SHALL référencer une vidéo YouTube par ID + seconde de départ + durée
(5–60 s). L'extrait est **lu via le lecteur YouTube embarqué** côté hôte au
moment du jeu ; aucun fichier audio n'est extrait ni stocké.

#### Scenario: Lien YouTube valide accepté
- **WHEN** l'hôte fournit une URL YouTube (ou un ID) analysable, un départ et une durée
- **THEN** le système enregistre l'ID vidéo, le départ et la durée pour la manche

#### Scenario: Lien invalide rejeté avec message clair
- **WHEN** l'hôte fournit un lien YouTube non analysable
- **THEN** le système refuse et indique la manche fautive (« Manche N : lien
  YouTube invalide »)

### Requirement: QCM par manche
Chaque manche SHALL comporter une question, 2 à 6 propositions et exactement une
bonne réponse ; la réponse révélée est facultative (par défaut la bonne
proposition). Les propositions vides sont ignorées et l'index de la bonne réponse
est recalé sur les propositions réellement remplies.

#### Scenario: Manche complète enregistrée
- **WHEN** l'hôte fournit un lien valide, une question, ≥ 2 propositions et coche
  la bonne réponse
- **THEN** la manche est enregistrée et incluse dans la playlist

#### Scenario: Propositions vides tolérées sans casser l'index
- **WHEN** l'hôte laisse des cases de proposition vides, y compris avant la bonne
  réponse
- **THEN** le système ne garde que les propositions remplies et pointe la bonne
  réponse sur la bonne, sans erreur « quiz invalide »

### Requirement: Aperçu d'un extrait
L'hôte SHALL pouvoir écouter l'extrait d'une manche au timestamp réglé, depuis le
constructeur, pour vérifier le morceau avant d'enregistrer.

#### Scenario: Aperçu d'une manche
- **WHEN** l'hôte clique « Aperçu » sur une manche dont le lien est valide
- **THEN** un lecteur YouTube embarqué joue l'extrait à partir du départ réglé

### Requirement: Import semi-automatique d'une playlist YouTube
Si une clé `YOUTUBE_API_KEY` est configurée, l'hôte SHALL pouvoir générer une
playlist à partir d'une playlist YouTube publique : titres récupérés via l'API
YouTube Data v3 (métadonnées seulement), nettoyés, tirés au sort, avec un QCM par
morceau dont les leurres proviennent de toute la playlist.

#### Scenario: Génération « surprise » sans dévoiler les morceaux
- **WHEN** l'hôte lance l'import en mode surprise sur une playlist valide
- **THEN** le système crée la playlist directement, sans jamais renvoyer les
  morceaux/réponses à l'hôte

#### Scenario: Import indisponible sans clé API
- **WHEN** aucune `YOUTUBE_API_KEY` n'est configurée
- **THEN** la fonction d'import est masquée et l'endpoint répond HTTP 503

## Évolution future (hors v1, change à proposer)

- Extraction serveur (yt-dlp + ffmpeg) d'extraits audio, stockage Cloudflare R2.
- Upload manuel d'un fichier audio en secours quand l'extraction échoue.
- Re-cut serveur du timestamp avec remplacement de l'extrait.
