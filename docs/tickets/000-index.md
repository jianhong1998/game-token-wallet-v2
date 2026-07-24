# V2 Tickets — Index

Tracer-bullet vertical slices for the V2 rebuild (new repo), derived from
[001-PRD.md](../business-related/001-PRD.md) and the architecture decisions in [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md).
Each ticket is a complete path through on-chain program, Server Action, and
frontend for one user-visible capability. Numbered in dependency order —
work the frontier (any ticket whose blockers are all done).

Open questions not yet resolved (hashing algorithm, exact numeric caps,
CI stage gating, deposit conversion rate, etc.) are tracked in
[002-pending-discussion.md](../business-related/002-pending-discussion.md) — check it before implementing a ticket that
touches one of those areas.

| #   | Title                                     | Blocked by | Status  |
| --- | ----------------------------------------- | ---------- | ------- |
| 001 | Repo bootstrap & connection utility       | None       | Done    |
| 002 | Registry account + init                   | 001        | Done    |
| 003 | User registration & login                 | 001, 017   | Pending |
| 004 | Devnet deploy pipeline + Docker self-host | 001, 003   | Pending |
| 005 | Create game (General Mode, public)        | 002, 003   | Pending |
| 006 | Join game (public)                        | 005        | Pending |
| 007 | Private games (password-protected)        | 005, 006   | Pending |
| 008 | Deposit / mint to player                  | 006        | Pending |
| 009 | General Mode transfers                    | 008        | Pending |
| 010 | Game admin transfer                       | 006        | Pending |
| 011 | Quit game                                 | 009        | Pending |
| 012 | Delete user account                       | 003, 011   | Pending |
| 013 | Close game (General Mode)                 | 002, 009   | Pending |
| 014 | Poker Mode: single pot                    | 006, 008   | Pending |
| 015 | Poker Mode: side pots                     | 014, 013   | Pending |
| 016 | General Pool Mode                         | 008, 013   | Pending |
| 017 | Frontend design foundation                | 001        | Done    |

## Dependency diagram

```mermaid
graph TD
    001["001 Repo bootstrap & connection utility"]
    002["002 Registry account + init"]
    017["017 Frontend design foundation"]
    003["003 User registration & login"]
    004["004 Devnet deploy pipeline + Docker self-host"]
    005["005 Create game (General Mode, public)"]
    006["006 Join game (public)"]
    007["007 Private games (password-protected)"]
    008["008 Deposit / mint to player"]
    009["009 General Mode transfers"]
    010["010 Game admin transfer"]
    011["011 Quit game"]
    012["012 Delete user account"]
    013["013 Close game (General Mode)"]
    014["014 Poker Mode: single pot"]
    015["015 Poker Mode: side pots"]
    016["016 General Pool Mode"]

    001 --> 002
    001 --> 017
    017 --> 003
    001 --> 003
    001 --> 004
    003 --> 004
    002 --> 005
    003 --> 005
    005 --> 006
    005 --> 007
    006 --> 007
    006 --> 008
    008 --> 009
    006 --> 010
    009 --> 011
    003 --> 012
    011 --> 012
    002 --> 013
    009 --> 013
    006 --> 014
    008 --> 014
    014 --> 015
    013 --> 015
    008 --> 016
    013 --> 016
```
