## ADDED Requirements

### Requirement: Quiz creation
A logged-in host SHALL be able to create a quiz identified by a title, owned by their account.

#### Scenario: Host creates a quiz
- **WHEN** a logged-in host submits a quiz title
- **THEN** the system creates a quiz owned by that host and shows it in the host's quiz list

### Requirement: Question creation from YouTube URL
A logged-in host SHALL be able to add a question to one of their quizzes by providing a YouTube URL and a start timestamp, and the system SHALL attempt to extract a 30-second audio clip automatically.

#### Scenario: Successful automatic extraction
- **WHEN** a host submits a YouTube URL and a start timestamp for a new question
- **THEN** the system extracts a 30-second audio clip starting at that timestamp, stores it, and marks the question's clip as ready

#### Scenario: Extraction failure is detected and surfaced
- **WHEN** the extraction process fails for the submitted URL/timestamp (video unavailable, region-locked, removed, or extraction error)
- **THEN** the system marks the question's clip as failed and surfaces the manual upload fallback for that question, without crashing the quiz-creation flow

### Requirement: Clip preview and re-cut
A host SHALL be able to preview (listen to) an extracted or uploaded clip for a question, and re-submit a different start timestamp to re-cut the clip before finalizing the question.

#### Scenario: Host previews a ready clip
- **WHEN** a host opens a question whose clip status is ready
- **THEN** the host can play the clip in the browser before saving the question

#### Scenario: Host re-cuts a bad clip
- **WHEN** a host submits a new start timestamp for a question that already has a clip
- **THEN** the system re-runs extraction with the new timestamp and replaces the previous clip on success

### Requirement: Manual upload fallback
When automatic extraction has failed for a question, the system SHALL let the host upload an audio file directly to serve as that question's clip.

#### Scenario: Host uploads a replacement clip after extraction failure
- **WHEN** a host uploads an audio file for a question whose clip status is failed
- **THEN** the system stores the uploaded file as the question's clip, marks the clip as ready, and records its source as manual upload

#### Scenario: Upload fallback is not offered when extraction already succeeded
- **WHEN** a question's clip status is ready from a successful automatic extraction
- **THEN** the system does not require or prompt for a manual upload for that question

### Requirement: Answer and decoys per question
For each question, a host SHALL manually enter exactly one correct answer and one or more decoy answers to form a multiple-choice set.

#### Scenario: Host saves a complete question
- **WHEN** a host provides a correct answer and at least one decoy for a question with a ready clip
- **THEN** the system saves the question as complete and includes it in the quiz

#### Scenario: Incomplete question cannot be saved
- **WHEN** a host attempts to save a question missing a correct answer, missing all decoys, or with no ready clip
- **THEN** the system rejects the save and indicates what is missing
