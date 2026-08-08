## ADDED Requirements

### Requirement: Authenticated visitors are redirected off `/login` and `/register`
The system SHALL redirect a request to exactly `/login` or `/register` carrying a valid session cookie to `/`. A missing, invalid, or expired session cookie SHALL leave the existing unauthenticated-visitor behavior unchanged (the page renders normally).

#### Scenario: Authenticated user redirected away from `/login`
- **WHEN** a visitor with a valid session cookie requests `/login`
- **THEN** the system redirects the request to `/`

#### Scenario: Authenticated user redirected away from `/register`
- **WHEN** a visitor with a valid session cookie requests `/register`
- **THEN** the system redirects the request to `/`

#### Scenario: Unauthenticated visitor unaffected
- **WHEN** a visitor with no session cookie, or an invalid/expired one, requests `/login` or `/register`
- **THEN** the system renders the requested page normally, with no redirect
