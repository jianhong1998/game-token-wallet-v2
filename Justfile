# Initialize repo (Git, PNPM)
[group: 'Init']
init:
  @chmod +x ./.hooks/* && \
    git config core.hooksPath ./.hooks && \
    echo "✅ Git hooks are initialized"

help:
  @just -l

[group: 'CI']
lint:
  @pnpm lint

[group: 'CI']
typecheck:
  @pnpm typecheck

[group: 'Dev']
dev-up:
  @docker compose up --build

[group: 'Dev']
dev-down:
  @docker compose down --volumes