# Initialize repo (Git, PNPM)
[group: 'Init']
init:
  @chmod +x ./.hooks/* && \
    git config core.hooksPath ./.hooks && \
    echo "✅ Git hooks are initialized"

help:
  @just -l