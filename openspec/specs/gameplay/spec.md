# gameplay

_Nouvelle spec : décrit le jeu en temps réel livré en v1, qui n'avait aucune
spec (le change phase-1 s'arrêtait à la création de quiz). Couvre les salles, le
déroulé d'une manche, le scoring, les modes solo/équipes, le mode automatique, le
son sur les téléphones et l'écran public._

## Requirements

### Requirement: Salle isolée avec code + QR
Un hôte connecté SHALL ouvrir une salle pour une de ses playlists, identifiée par
un code court non ambigu et un QR code. Les salles sont isolées : aucune donnée
d'une salle n'est visible depuis une autre.

#### Scenario: Ouverture d'une salle
- **WHEN** l'hôte confirme la configuration d'une salle pour une playlist
- **THEN** le système crée une salle avec un code + QR et place l'hôte dans le lobby

#### Scenario: Isolation de deux salles simultanées
- **WHEN** deux salles tournent en parallèle
- **THEN** les joueurs, réponses et classements de l'une ne sont jamais visibles
  dans l'autre

### Requirement: Arrivée des joueurs (sans compte)
Un joueur SHALL rejoindre une salle avec un code + un pseudo (unique dans la
salle), sans compte, uniquement tant que la salle est au lobby.

#### Scenario: Rejoindre au lobby
- **WHEN** un joueur soumet un code valide et un pseudo libre alors que la salle
  est au lobby
- **THEN** le joueur rejoint la salle et apparaît chez l'hôte

#### Scenario: Rejoindre une partie déjà lancée refusé
- **WHEN** un joueur tente de rejoindre une salle dont la partie a commencé
- **THEN** le système refuse

### Requirement: Le minuteur ne démarre qu'au vrai départ de l'extrait
La fenêtre de réponse d'une manche SHALL ne s'ouvrir que lorsque l'extrait joue
réellement, pas au clic « démarrer » ni pendant le chargement, pour ne pas voler
de secondes aux joueurs.

#### Scenario: Chargement puis départ
- **WHEN** l'hôte lance une manche
- **THEN** les joueurs patientent pendant le chargement, puis reçoivent la question
  et le minuteur au moment où l'extrait démarre

### Requirement: Scoring serveur-autoritaire
Les points SHALL être calculés **uniquement à partir d'horodatages serveur**
(base + bonus de vitesse), jamais d'une valeur envoyée par le client.

#### Scenario: Bonne réponse rapide marque plus qu'une bonne réponse lente
- **WHEN** deux joueurs répondent juste, l'un plus tôt que l'autre
- **THEN** le plus rapide obtient plus de points, selon le temps mesuré côté serveur

### Requirement: Bonus de série (combo), activable par l'hôte
Le système SHALL, si l'hôte l'active à l'ouverture de la salle, ajouter un bonus
croissant pour les bonnes réponses consécutives (plafonné), remis à zéro à toute
mauvaise réponse.

#### Scenario: Combo désactivé
- **WHEN** l'hôte a désactivé le combo
- **THEN** aucun bonus de série n'est appliqué

### Requirement: Mode solo ou équipes (au choix de l'hôte)
En mode équipes, chaque joueur est sur son propre téléphone, rattaché à une
équipe. L'équipe vote (tally en direct, vote modifiable) ; un membre verrouille la
réponse la plus votée ; sans verrouillage, la fin du minuteur retient la plus
votée (départage : la première option votée). Le score est commun ; classement
par équipe.

#### Scenario: Sélecteur d'équipe en direct
- **WHEN** une équipe est créée sur un téléphone pendant que d'autres joueurs sont
  sur l'écran de choix d'équipe
- **THEN** la nouvelle équipe apparaît en direct chez ces joueurs

### Requirement: Contrôles hôte et annulation
L'hôte SHALL pouvoir, pendant la partie : rejouer l'extrait, mettre en pause /
reprendre (chrono gelé équitablement), passer une manche (sans la noter), exclure
un joueur, et **annuler la partie** (retour au lobby, scores remis à zéro).

#### Scenario: Annulation d'une partie lancée
- **WHEN** l'hôte annule la partie en cours
- **THEN** tout le monde revient au lobby, les scores sont remis à zéro et la
  partie peut être relancée

### Requirement: Mode automatique (l'hôte joue aussi)
Le système SHALL proposer un mode où l'écran de l'hôte masque la vidéo (audio +
visualiseur) et où la partie s'enchaîne seule : révélation automatique, manche
suivante après un délai réglable, podium final. Dès que toutes les unités
(joueurs/équipes) ont répondu, la révélation intervient après un court délai sans
attendre le minuteur. Les joueurs voient le décompte avant la chanson suivante.

#### Scenario: Enchaînement sans intervention
- **WHEN** une manche se termine en mode automatique
- **THEN** le système enchaîne seul vers la manche suivante (ou le podium), après
  le délai réglé, avec un décompte visible côté joueurs

### Requirement: Son sur les téléphones (opt-in, sans fuite par défaut)
Si l'hôte l'active, chaque joueur SHALL pouvoir entendre l'extrait sur son
téléphone (lecteur caché, audio seul), la lecture étant tentée automatiquement.
Sans cette option, aucun identifiant vidéo n'est transmis aux joueurs.

#### Scenario: Pas de fuite quand l'option est désactivée
- **WHEN** l'option « son sur les téléphones » est désactivée
- **THEN** les payloads envoyés aux joueurs ne contiennent aucun identifiant vidéo

### Requirement: Écran public à projeter (sans dévoiler la vidéo)
Le système SHALL fournir un écran public (fenêtre séparée) affichant code, QR,
minuteur, question, propositions, résultats et classement, **mais jamais la
vidéo**. Les propositions n'y apparaissent qu'au vrai démarrage de l'extrait.

#### Scenario: Pas de spoiler avant le départ
- **WHEN** une manche se prépare (extrait pas encore lancé)
- **THEN** l'écran public affiche « prépare-toi » sans les propositions, qui
  n'apparaissent qu'au démarrage réel de l'extrait

### Requirement: Reconnexion
Recharger la page ou perdre le réseau SHALL ne pas faire perdre son score ni sa
place à un joueur, ni empêcher l'hôte de reprendre la main sur sa salle.

#### Scenario: Reconnexion d'un joueur
- **WHEN** un joueur recharge en cours de partie
- **THEN** il retrouve son score et l'état courant de la manche
