# syntax=docker/dockerfile:1

# Production image for the single WarsWorld process: Next (SSR + static), the tRPC API and the
# WebSocket server all run in ONE node process on ONE port — see src/server/main-production.ts.
#
# Debian slim rather than Alpine on purpose: `bcrypt` and `sharp` are native modules whose prebuilt
# binaries target glibc, so musl tends to force a source build (and a whole toolchain in the image).
# The matching Prisma engine is declared in schema.prisma as `debian-openssl-3.0.x`.

FROM node:21-slim AS base
# Prisma's query engine needs OpenSSL; ca-certificates for outbound TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app


FROM base AS build

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time — they are NOT read at runtime.
# Setting them only in docker-compose `environment:` would silently ship a bundle pointing at
# localhost, so they must arrive here as build args.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npx prisma generate
RUN npm run build


FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3001

# Dev dependencies are deliberately KEPT: the `prisma` CLI lives there and the release step runs
# `npm run prisma:deploy` inside this image. Pruning them would mean shipping a second image (or
# installing Prisma at deploy time) purely to run migrations.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
# The server bundle `npm start` actually executes. Omitting it is silent until the container starts.
COPY --from=build --chown=node:node /app/dist ./dist
# 17 MB of sprites — without these the board renders blank.
COPY --from=build --chown=node:node /app/public ./public
# Needed by `prisma migrate deploy` at release time.
COPY --from=build --chown=node:node /app/prisma ./prisma
# Next reads its config at runtime, not just at build.
COPY --from=build --chown=node:node /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3001

CMD ["npm", "run", "start"]
