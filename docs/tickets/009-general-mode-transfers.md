# 009 — General Mode transfers

**What to build:** Players can send tokens directly to one or several other players in the same game.

**Blocked by:** 008

**Status:** ready-for-agent

- [ ] Single-recipient `transfer_token` instruction (fixed accounts — sender, sender ATA, recipient, recipient ATA, token program; no dynamic recipient list) moves tokens between two players' ATAs for the same game (per [002-architecture-decisions.md](../technical-related/architecture/002-architecture-decisions.md) Q14).
- [ ] Server Action accepts a list of `{recipient, amount}` pairs, composes one instruction per recipient, and chunks them across multiple transactions if a batch doesn't fit Solana's per-transaction limits — verified against a realistic worst case (transferring to close to 19 recipients at once, the max for a 20-player game).
- [ ] Frontend transfer form supports selecting multiple recipients with independent amounts in a single submit action.
- [ ] Insufficient balance for the full batch fails cleanly — no transfer is shown to the user as "succeeded" if it didn't fully apply; document whether partial success across chunked transactions can occur and how it's surfaced.
