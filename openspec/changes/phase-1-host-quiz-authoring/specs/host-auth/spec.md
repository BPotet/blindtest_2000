## ADDED Requirements

### Requirement: Host account creation
The system SHALL allow a visitor to create a host account using an email address and a password.

#### Scenario: Successful signup
- **WHEN** a visitor submits a valid, previously-unused email and a password meeting the minimum length policy
- **THEN** the system creates a host account and starts an authenticated session for that host

#### Scenario: Duplicate email rejected
- **WHEN** a visitor submits an email that already has a host account
- **THEN** the system rejects the signup with a clear error and does not create a duplicate account

### Requirement: Host login
The system SHALL allow a host with an existing account to log in using their email and password.

#### Scenario: Successful login
- **WHEN** a host submits the email and password matching an existing account
- **THEN** the system starts an authenticated session for that host and grants access to their quizzes

#### Scenario: Wrong password rejected
- **WHEN** a host submits an email with an incorrect password
- **THEN** the system rejects the login with a clear error and does not start a session

### Requirement: Session persistence
The system SHALL keep a host logged in across page reloads and new visits until they explicitly log out or the session expires.

#### Scenario: Session survives reload
- **WHEN** a logged-in host reloads the page or returns in a new browser tab within the session lifetime
- **THEN** the host remains authenticated without re-entering credentials

#### Scenario: Logout ends session
- **WHEN** a logged-in host clicks "log out"
- **THEN** the system ends the session and subsequent requests to host-only pages require logging in again
