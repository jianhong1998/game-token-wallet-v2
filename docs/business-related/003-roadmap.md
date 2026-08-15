# V2 — Roadmap

Deferred features noted during ticket work, not yet scoped into a ticket.

## Kick player (admin-initiated removal)

Ticket 011 (quit game) is self-service only — a player can leave a game
themselves, but there's no way for a game's admin to remove a player who
won't leave voluntarily. Deferred during 011's grill-me session
(2026-08-13): same burn-and-close-ATA mechanics as `quit_game`, but
admin-authorized instead of self-authorized, and admin can't target
themselves (mirrors 011's own admin-can't-quit rule — use admin-transfer
(010) or close-game (013) instead).
