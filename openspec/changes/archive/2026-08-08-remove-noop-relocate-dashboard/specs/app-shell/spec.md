## ADDED Requirements

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
