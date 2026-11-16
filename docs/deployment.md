# Deployment runbook

**Target: one small VPS running the app and Postgres together, via Docker Compose.**

## Why one box

The app is a single stateful process. `src/server/main-production.ts` builds its own Next app,
routes all HTTP through `app.getRequestHandler()`, and attaches the tRPC WebSocket server to the
same `http.Server` — Next, the API and the live match feed all share one port in one process. On top
of that, `matchStore` holds live match state in memory and the emitters hold WS subscriber handles,
so **a second replica would be a second, divergent world.** Until the game tier is sharded, one
instance is not a compromise; it is the design.

Co-locating Postgres also removes a storage cliff. The event log is append-only and grows roughly
**80 MB/month** at ~30 games/day. That is a problem against a managed free tier (500 MB) and a
non-issue against local VPS disk — even the 20 GB entry tiers hold years of it.

Rough cost: **€4–8/month** all-in (see "Choosing a host"). Verify current pricing — it moves.

> **Not Cloud Run / serverless.** The turn clock, pick deadlines and matchmaking queue tick are
> in-process timers, and `matchStore` is in-process memory. That forces always-allocated CPU, which
> costs roughly 10× a VPS — while the platform's request timeout also caps long-lived WebSockets.
> Paying a premium to disable the features that make serverless cheap is the worst of both worlds.

## What is in the stack

| Service    | Role                                                              |
| ---------- | ----------------------------------------------------------------- |
| `app`      | the one Node process (Next + tRPC + WS)                           |
| `postgres` | Postgres 17, **not** published to the internet                    |
| `caddy`    | TLS termination + reverse proxy; the only service with open ports |
| `backup`   | nightly `pg_dump`, rotated                                        |

## Image build (CI, once per change)

The image is **built by GitHub Actions and pushed to GHCR** — the VPS only pulls it, so the box
never runs the memory-hungry `next build` and a 2 GB instance is enough.

The workflow `.github/workflows/publish-image.yml` builds on every push to `main` that touches app
code (and on manual dispatch) and pushes `ghcr.io/<owner>/warsworld:latest` plus a `sha-<short>` tag.

**One-time setup in the GitHub repo** (Settings → Secrets and variables → Actions → **Variables**):

| Variable              | Value                   |
| --------------------- | ----------------------- |
| `NEXT_PUBLIC_APP_URL` | `https://<your-domain>` |
| `NEXT_PUBLIC_WS_URL`  | `wss://<your-domain>`   |

These are **build-time** values inlined into the client bundle, which is why they are CI variables,
not VPS env. They are public URLs, not secrets — hence _variables_, not _secrets_. Change the domain
⇒ update them and re-run the workflow. The first run also publishes the package; make it **public**
once (repo → Packages → the image → Package settings → Change visibility) so the VPS can pull
without a login.

## First deploy

### 1. Prepare the host

A VPS with Docker and Compose, and a DNS `A`/`AAAA` record for your domain already pointing at it —
Caddy needs that resolving before it can obtain a certificate. **2 GB RAM / 20 GB disk is enough**
(no build happens here). See "Choosing a host" below.

### 2. Configure

```bash
cp .env.production.example .env.production
# fill it in — every value; several have no safe default
```

Generate real secrets (`openssl rand -base64 32`) for `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET` and
`AUTH_SECRET`. **Never reuse the placeholders from `.env.example`** — they are public. Set
`APP_IMAGE` to the ghcr.io ref from the build above.

### 3. Pull and start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

### 4. Apply the schema

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm app npm run prisma:deploy
```

`migrate deploy` only applies pending migrations — it never resets and never generates. It is the
only Prisma command that should touch a deployment. Do **not** use `db push` here.

This is a deliberate release step: `start:server` does not migrate on boot, so a cold start never
waits on (or half-applies) a schema change.

### 5. Seed reference data

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm app npm run prisma:seed:reference
```

**Required, not optional** — the engine reads commanders, units and terrain from the database at
boot (`initGameData`), so an unseeded deployment cannot start a match. Seeds units, terrain,
properties, commanders, skins and the map pool; creates no users.

> ### 🔴 Never run `npm run prisma:seed` against a deployment
>
> `prisma/seed.ts` is the **dev** seed. Alongside the same reference data it creates a
> `development_user` holding **every role including `admin`**, with the password `secret`, plus
> fixture players, articles and sample matches. Running it against a real database hands full
> control of the ladder to anyone who guesses those credentials.

Note `prisma:seed:reference` **clears and re-inserts** the reference tables, so run it before the
deployment takes traffic, or in a maintenance window when refreshing content.

## Updating

CI publishes a new image on merge to `main`. On the VPS:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm app npm run prisma:deploy
docker image prune -f    # drop the now-unused previous image so disk doesn't creep
```

Run `prisma:deploy` **after** the new image is up only when migrations are additive. For a
destructive change, stop the app first so it never talks to a schema it was not built for.

`pull_policy: always` on the `app` service means `up -d` alone also fetches the newest `latest`; the
explicit `pull` just makes the download a distinct, watchable step. To roll back, set `APP_IMAGE` to
a specific `sha-<short>` tag and re-run `pull` + `up -d`.

## Backups

The `backup` service writes a compressed `pg_dump` to `./backups` every 24h and keeps the newest 14
(`BACKUP_KEEP`). Dumps are written to a `.tmp` name and renamed on success, so an interrupted dump
can never be mistaken for a good one.

### ⚠️ Local dumps are not a backup

They sit on the same disk as the database. Lose the VPS and you lose both. **Copy them off the box**
— that step is yours, and it is the one that actually protects you:

```bash
# e.g. nightly, from another machine or a cron on the host
rclone sync /path/to/backups remote:warsworld-backups
```

Scaleway Object Storage has a free tier that comfortably fits months of dumps.

### Restore

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < backups/warsworld-<stamp>.dump
```

**Practise this once, now, against a scratch database.** A backup you have never restored is a
hypothesis, not a backup.

## Alternative: managed Postgres (Supabase)

If you would rather not own database ops, point `DATABASE_URL` at Supabase and drop the `postgres`
and `backup` services. You gain automated PITR backups; you take on the storage cliff above (~6
months on the free tier) and a ~$25/month decision after that.

Supabase runs **Postgres 17**. Pick the connection mode deliberately:

| Mode               | Host                        | Migrations?                                    |
| ------------------ | --------------------------- | ---------------------------------------------- |
| Direct             | `db.<ref>.supabase.co:5432` | ✅ best fit. IPv6-only without the IPv4 add-on |
| Session pooler     | `…pooler.supabase.com:5432` | ✅ safe fallback                               |
| Transaction pooler | `…pooler.supabase.com:6543` | ❌ **cannot run DDL**; needs `?pgbouncer=true` |

## Choosing a host

Because CI builds the image, the box only needs to **pull and run** — so **2 vCPU / 2 GB RAM /
20 GB disk** is enough. Growth is the append-only event log at ~80 MB/month, so 20 GB lasts years;
`docker image prune -f` on update keeps old image layers from creeping. Prices below are mid-2026
(all three EU providers raised entry tiers that year); **verify in the console before ordering**.

| Provider | Plan    | Specs                 | ~Price/mo | Notes                                               |
| -------- | ------- | --------------------- | --------- | --------------------------------------------------- |
| OVH      | Starter | 2 vCPU · 2 GB · 40 GB | ~€3.99    | French; unlimited traffic; 40 GB is free headroom   |
| Scaleway | DEV1-S  | 2 vCPU · 2 GB · 20 GB | ~€6.34    | French; 20 GB fits but is the tightest; free egress |
| Hetzner  | CX22    | 2 vCPU · 4 GB · 40 GB | ~€3.79    | German (EU DCs); most RAM+disk for the price        |

Any of them runs this stack identically. Pick on price and familiarity, not capability.

## Notes and constraints

- **Single instance only** — see "Why one box". Do not scale `app`.
- **Prisma engine targets.** `schema.prisma` declares `debian-openssl-3.0.x` for the production
  image (node:22-slim, glibc). Switching the base image to Alpine or to **ARM** needs the matching
  target (`linux-musl-openssl-3.0.x`, `linux-arm64-openssl-3.0.x`) or Prisma fails at container
  start with a confusing "query engine not found".
- **Dev dependencies — and `src/` + `tsconfig.json` — ship in the image** on purpose. The `prisma`
  CLI runs the release step, and `prisma:seed:reference` executes TypeScript through `tsx` whose
  imports (`frontend/utils/sprites`, engine constants) resolve via tsconfig's `baseUrl: ./src`.
  Drop any of them and the seed fails with `Cannot find package 'frontend'`.
- **The CI image is `linux/amd64`** (see the `platforms:` line in the publish workflow), matching an
  x86 VPS (OVH / Scaleway / Hetzner CX). To run on an **ARM** box (Hetzner CAX) add `,linux/arm64`
  there — the `linux-arm64-openssl-3.0.x` Prisma engine is already declared, so it just works, at
  the cost of a slower multi-arch build.
- **Node 22 LTS everywhere** — `engines`, `.node-version`, `nixpacks.toml`, the Dockerfile and CI.
  Node 21 was EOL, and `vitest@4` / `vite@8` / `rolldown` require `^20.19.0 || >=22.12.0`, so 21 was
  never a supported target for the test toolchain. Keep these five in step when upgrading.
- **`.npmrc` sets `legacy-peer-deps=true`** because `@auth/core@0.24` wants `nodemailer@^6` while
  `next-auth@4.24` wants `^7`. npm 11 papers over that silently, npm 10 (Docker, CI) fails hard —
  which is precisely how the lockfile drifted while local installs kept working. Remove the flag
  once those two agree on a nodemailer major.
- **`.dockerignore` is load-bearing.** Without it `COPY . .` overwrites the Linux `node_modules`
  installed by `npm ci` with the host's — on macOS that puts darwin-arm64 binaries for `sharp`,
  `bcrypt` and the Prisma engine into a Linux image, which fails at run time, not build time.
- `deployment/` holds an older, unfinished Terraform/AWS setup from upstream. It is superseded by
  this document.
