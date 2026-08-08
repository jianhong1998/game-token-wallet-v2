## Purpose

Cross-cutting routing/session behavior for the app shell: which routes require an authenticated session, which are guest-only, and how visitors are redirected between them.

## Requirements

### Requirement: Root route requires an authenticated session
The system SHALL treat `/` as a protected `(app)` route: it SHALL render the authenticated placeholder content for a visitor with a valid session, and SHALL redirect an unauthenticated visitor to `/login`, matching the gating already applied to every other `(app)` route.

#### Scenario: Authenticated visitor sees the dashboard placeholder at `/`
- **WHEN** a visitor with a valid session cookie requests `/`
- **THEN** the system renders the authenticated placeholder (welcome message + logout button) without redirecting

#### Scenario: Unauthenticated visitor is redirected away from `/`
- **WHEN** a visitor with no session cookie, or an invalid/expired one, requests `/`
- **THEN** the system redirects the request to `/login`

### Requirement: No connectivity smoke-test content is publicly reachable
The system SHALL NOT expose the ticket-001 `noop` connectivity demo (page, Server Action, or on-chain instruction) anywhere in the app.

#### Scenario: Root no longer serves the noop demo
- **WHEN** any visitor requests `/`
- **THEN** the response is either the authenticated dashboard placeholder or a redirect to `/login` — never the "Send noop transaction" demo page

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
