# WarsWorld production image.
#
# Plain Dockerfile syntax on purpose — no `# syntax=` directive, so a build never has to pull the
# BuildKit frontend image first.
#
# One process serves everything: `src/server/main-production.ts` boots Next itself and attaches the
# tRPC WebSocket to the SAME http server, so there is no separate :3001 service in production — the
# browser only ever talks to one origin.
#
# Debian (bookworm-slim) rather than Alpine on purpose: `bcrypt` and `sharp` ship glibc prebuilds,
# so nothing has to compile from source, and Prisma's `debian-openssl-3.0.x` engine matches.

# ---------------------------------------------------------------------------------------------
# Stage 1 — dependencies
# ---------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# openssl: required by the Prisma query engine. ca-certificates: TLS for OAuth calls at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# devDependencies are kept: the image doubles as the migration/seed runner (prisma CLI, tsx).
RUN npm ci

# ---------------------------------------------------------------------------------------------
# Stage 2 — build
# ---------------------------------------------------------------------------------------------
FROM deps AS build

# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so they must be known here.
# Whatever origin you build with is the origin the browser will call — rebuild to change it.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_LOG_LEVEL=warn
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
  NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
  NEXT_PUBLIC_LOG_LEVEL=$NEXT_PUBLIC_LOG_LEVEL \
  NODE_ENV=production \
  CI=1

COPY . .

# Fail loudly here instead of shipping a bundle that throws "NEXT_PUBLIC_APP_URL is undefined"
# in the user's browser (see src/frontend/utils/trpc-client.ts).
RUN test -n "$NEXT_PUBLIC_APP_URL" || (echo "NEXT_PUBLIC_APP_URL build-arg is required" && exit 1)
RUN test -n "$NEXT_PUBLIC_WS_URL" || (echo "NEXT_PUBLIC_WS_URL build-arg is required" && exit 1)

# Prisma client must exist before `next build` compiles anything importing it.
RUN npx prisma generate

# `next build` + the esbuild server bundle (dist/server/main-production.mjs).
RUN npm run build

# ---------------------------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  PORT=3000 \
  NEXT_TELEMETRY_DISABLED=1

# The server bundle keeps `next`, `@prisma/client`, `bcrypt` and `ws` external (see
# bundleServer.mjs), and Next serves `.next` + `public` from disk — so the whole app tree ships.
COPY --from=build --chown=node:node /app /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["npm", "run", "start"]
