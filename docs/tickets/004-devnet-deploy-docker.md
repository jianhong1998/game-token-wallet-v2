# 004 — Devnet deploy pipeline + Docker self-host

**What to build:** A real, reachable devnet deployment of the program and app, matching the PRD's deployment requirements (CircleCI, self-hosted Docker, env-controlled program ID).

**Blocked by:** 001, 003

**Status:** ready-for-agent

- [ ] Anchor program deploys to devnet with the program ID controlled via environment variable — the app reads the deployed program ID from env, not the hardcoded IDL address.
- [ ] CircleCI has a devnet-deploy job; decide and document whether it's automatic on merge to main or manually gated.
- [ ] Next.js app builds into a Docker image intended for self-hosting; verified that no secret or environment-specific value is baked in at image-build time — all config is read at container runtime.
- [ ] End-to-end smoke test: a user can register and log in against the live devnet deployment through the Dockerized app.
