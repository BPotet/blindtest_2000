# host-auth

_Spec de l'état livré (v1). Remplace le volet auth du change
`phase-1-host-quiz-authoring`, qui décrivait une authentification par e-mail
jamais implémentée. L'auth réelle est par **identifiant (username)**, avec
inscription libre multi-comptes et un compte admin de départ configurable._

## Requirements

### Requirement: Inscription libre d'un compte hôte
Le système SHALL permettre à un visiteur de créer un compte hôte avec un
identifiant (username) et un mot de passe. L'inscription démarre immédiatement
une session authentifiée.

#### Scenario: Inscription réussie
- **WHEN** un visiteur soumet un identifiant inutilisé (3–40 caractères,
  lettres/chiffres/`._-`) et un mot de passe d'au moins 6 caractères
- **THEN** le système crée le compte, hache le mot de passe (scrypt) et ouvre une
  session pour ce compte

#### Scenario: Identifiant déjà pris (insensible à la casse)
- **WHEN** un visiteur soumet un identifiant déjà utilisé (quelle que soit la casse)
- **THEN** le système refuse (HTTP 409) sans créer de doublon ni écraser le compte

### Requirement: Compte admin de départ configurable
Le système SHALL (ré)appliquer au démarrage un compte hôte de départ défini par
l'environnement (`ADMIN_USERNAME`/`ADMIN_PASSWORD`), afin de fournir un premier
accès sans inscription préalable.

#### Scenario: Compte admin appliqué au démarrage
- **WHEN** le serveur démarre
- **THEN** un compte portant `ADMIN_USERNAME` (défaut `admin`) existe avec le mot
  de passe `ADMIN_PASSWORD` (défaut `admin`, avertissement en logs si non défini)

### Requirement: Connexion
Le système SHALL permettre à un hôte existant de se connecter avec son
identifiant et son mot de passe.

#### Scenario: Connexion réussie
- **WHEN** l'hôte soumet un couple identifiant/mot de passe valide
- **THEN** le système ouvre une session et donne accès à ses playlists

#### Scenario: Mauvais mot de passe
- **WHEN** l'hôte soumet un mot de passe incorrect
- **THEN** le système refuse (HTTP 401) sans ouvrir de session

### Requirement: Session persistante par cookie signé
Le système SHALL maintenir l'hôte connecté entre les rechargements via un cookie
de session signé (HMAC), HttpOnly, `SameSite=Lax`, `Secure` en production,
jusqu'à déconnexion explicite ou expiration (7 jours).

#### Scenario: Session survit au rechargement
- **WHEN** un hôte connecté recharge la page dans la durée de vie de la session
- **THEN** il reste authentifié sans ressaisir ses identifiants

#### Scenario: Déconnexion
- **WHEN** un hôte connecté se déconnecte
- **THEN** le cookie de session est invalidé et les pages hôte redemandent une connexion

### Requirement: Isolation des playlists par compte
Chaque hôte SHALL ne voir et ne gérer que ses propres playlists (plus les quiz de
démonstration, communs à tous et non modifiables).

#### Scenario: Un hôte ne voit pas les playlists d'un autre
- **WHEN** l'hôte A liste ses playlists
- **THEN** il voit ses playlists et les démos, jamais celles de l'hôte B
