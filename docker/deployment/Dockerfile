FROM node:24.18.0-bookworm AS builder
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
WORKDIR /workspace
# tsconfig.base.json must be copied before the build step below —
# apps/frontend/tsconfig.json `extends` it, and Turbopack's tsconfig
# resolution fails hard ("doesn't resolve correctly") without it. The
# plan's original file list omitted this and the build broke immediately
# (see task log).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY apps/on-chain-client ./apps/on-chain-client
RUN pnpm install --frozen-lockfile
COPY apps/frontend ./apps/frontend
RUN pnpm --filter frontend run build

FROM node:24.18.0-bookworm-slim AS runner
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
WORKDIR /workspace
COPY --from=builder /workspace ./
WORKDIR /workspace/apps/frontend
EXPOSE 3000
CMD ["pnpm", "start"]
