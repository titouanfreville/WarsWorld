# Deploying WarsWorld to a Hetzner box (Ubuntu + Docker Compose)

One server, one compose stack: `postgres` + `app` + `nginx` (+ `certbot`). The app is a **single
Node process** — `src/server/main-production.ts` boots Next _and_ attaches the tRPC WebSocket to the
same http server, so there is no separate `:3001` service in production and the browser only ever
talks to one origin.

```
internet ──▶ nginx :80/:443 ──▶ app :3000 (Next + tRPC + WS) ──▶ postgres :5432
                                                                 (loopback only)
```

> **Run exactly one `app` replica.** It holds the live match store in memory, owns the WebSocket
> connections, and runs the matchmaking queue ticker and pick/lobby deadline timers. A second
> replica would double-tick the queue and lose subscribers. Scaling out means moving that state
> out of process first — not `--scale app=2`.

---

## 0. Prerequisites

- A Hetzner Cloud instance (CX22 / 2 vCPU / 4 GB is comfortable; the `next build` is the memory
  peak — on a 2 GB box add swap first).
- Ubuntu 22.04 / 24.04 / 26.04, SSH access as root or a sudo user. (Verified on 26.04 LTS
  "resolute"; the apt lines below read `$VERSION_CODENAME`, so they follow the release you're on.)
- The server's public IPv4 address. **No domain is required** — see step 5.

> **First login on a fresh Hetzner box.** If you created the server without attaching an SSH key,
> the emailed root password is **pre-expired**: you must change it in an interactive session with a
> real TTY. `ssh-copy-id`, `ssh <host> <command>` and any non-interactive tool fail with
> `Password change required but no TTY available.` — plain `ssh root@<ip>` first, change the
> password, then install your key.

## 1. Server setup

```bash
ssh root@<server-ip>

apt update && apt upgrade -y
apt install -y ca-certificates curl git ufw

# Docker Engine + compose plugin (official repo)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Firewall: SSH + web only. Postgres is bound to 127.0.0.1 and never exposed.
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

On a 2 GB instance, give the build room to breathe:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. Get the code

```bash
mkdir -p /srv && cd /srv
git clone https://github.com/titouanfreville/WarsWorld.git warsworld
cd /srv/warsworld
```

## 3. Configure

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
openssl rand -base64 32   # → PGPASSWORD
openssl rand -base64 32   # → NEXTAUTH_SECRET and AUTH_SECRET (same value)
nano .env.prod
```

For the **first** (plain-HTTP) boot, point the URLs at the bare IP:

```
NEXT_PUBLIC_APP_URL=http://<server-ip>
NEXT_PUBLIC_WS_URL=ws://<server-ip>
NEXTAUTH_URL=http://<server-ip>
NGINX_CONF=app-http.conf
```

> `NEXT_PUBLIC_*` are compiled into the client bundle. Changing them later needs
> `up -d --build`, **not** a restart.

Every command below uses the same prefix, so give it an alias:

```bash
echo "alias wwc='docker compose --env-file .env.prod -f docker-compose.prod.yaml'" >> ~/.bashrc
source ~/.bashrc
```

## 4. First boot

```bash
cd /srv/warsworld

wwc build app                       # ~5-10 min: npm ci + next build + esbuild server bundle
wwc up -d postgres
wwc --profile tools run --rm migrate            # prisma migrate deploy → creates the schema
wwc --profile tools run --rm migrate npm run prisma:seed:prod   # units, terrain, COs, skins
wwc up -d                           # app + nginx + certbot

wwc ps
wwc logs -f app                     # expect: "Production mode: HTTP + tRPC WebSocket listening…"
curl -fsS http://<server-ip>/api/health   # {"status":"ok"}
```

Then open `http://<server-ip>` in a browser.

**About the seed:** `npm run prisma:seed:prod` loads only the game-reference data the app cannot
boot without (`initGameData` reads CO profiles at startup). It deliberately does _not_ create the
`development_user`, fake players, articles or sample maps that `prisma/seed.ts` does — that seed is
dev-only and grants every role to one account. Each seeder clears its own tables before
re-inserting, so re-run it only when game data changes, not on every deploy.

You still need at least one map and one admin account:

- Register normally through the UI, then grant roles once, straight in the DB:
  ```bash
  wwc exec postgres psql -U warsworld -d warsworld \
    -c "UPDATE \"User\" SET roles = '{admin,moderator,dev,tester}' WHERE name = '<your-user>';"
  ```
- Import maps with the admin/map tools once you are logged in as that user.

## 5. HTTPS without a domain

Let's Encrypt will not issue for a bare IP with the standard flow, but it _will_ issue for a
hostname — and `sslip.io` resolves any `1-2-3-4.sslip.io` to `1.2.3.4` for free, no signup, no DNS
to manage. Use `203-0-113-7.sslip.io` (dashes for the dots of your IP). When you buy a real domain
later, the only change is these same values.

```bash
IP=<server-ip>
HOST=$(echo $IP | tr '.' '-').sslip.io
echo $HOST                      # e.g. 203-0-113-7.sslip.io

# nginx must already be serving :80 (step 4) so the http-01 challenge can be answered.
wwc run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d $HOST --email <you@example.com> --agree-tos --no-eff-email
```

Then switch the stack to TLS:

```bash
sed -i "s/<DOMAIN>/$HOST/g" deployment/nginx/app-ssl.conf

# .env.prod:
#   NGINX_CONF=app-ssl.conf
#   NEXT_PUBLIC_APP_URL=https://<host>
#   NEXT_PUBLIC_WS_URL=wss://<host>
#   NEXTAUTH_URL=https://<host>
nano .env.prod

wwc up -d --build app nginx     # rebuild: the NEXT_PUBLIC_* values are baked into the bundle
```

Renewal is automatic — the `certbot` service retries every 12h. Nginx needs to pick up the new
file, so reload it weekly (or after a renewal):

```bash
(crontab -l 2>/dev/null; echo "0 4 * * 1 cd /srv/warsworld && docker compose --env-file .env.prod -f docker-compose.prod.yaml exec nginx nginx -s reload") | crontab -
```

> Alternative: Let's Encrypt now issues certificates for **IP addresses** directly, but only in the
> short-lived profile (~6-day validity, renewal every few days, ACME-client support still uneven).
> The sslip.io hostname above gets you ordinary 90-day certs today with no moving parts.

## 6. Deploying an update

```bash
cd /srv/warsworld
git pull
wwc --profile tools run --rm migrate    # only if prisma/migrations changed
wwc up -d --build app
wwc logs -f app
```

Rollback is `git checkout <previous-sha> && wwc up -d --build app` — the DB is untouched by an app
rebuild.

## 7. Schema changes

`prisma/migrations/0_init/` is the baseline generated from `schema.prisma` with the pinned Prisma
5.8.1. From now on, production uses `migrate deploy` — never `db push`.

Locally, after editing `schema.prisma`:

```bash
npx prisma migrate dev --name <what-changed>   # writes prisma/migrations/<ts>_<name>/
```

If your **local dev database already has the tables** (it predates the baseline), tell Prisma the
baseline is already applied instead of letting it reset:

```bash
npx prisma migrate resolve --applied 0_init
```

Then commit the migration and deploy it with step 6.

## 8. Operations cheatsheet

```bash
wwc ps                                    # what is running
wwc logs -f app                           # app logs (LOG_LEVEL in .env.prod)
wwc restart app
wwc exec postgres psql -U warsworld -d warsworld

# backup / restore
wwc exec -T postgres pg_dump -U warsworld warsworld | gzip > ~/ww-$(date +%F).sql.gz
gunzip -c ~/ww-2026-07-23.sql.gz | wwc exec -T postgres psql -U warsworld -d warsworld

# prisma studio against production (tunnel it, do not expose it):
#   ssh -L 5555:127.0.0.1:5555 root@<server-ip>
wwc --profile tools run --rm -p 127.0.0.1:5555:5555 migrate \
  npx prisma studio --port 5555 --hostname 0.0.0.0
```

A nightly backup is worth wiring up on day one:

```bash
(crontab -l 2>/dev/null; echo "30 3 * * * cd /srv/warsworld && docker compose --env-file .env.prod -f docker-compose.prod.yaml exec -T postgres pg_dump -U warsworld warsworld | gzip > /srv/backups/ww-\$(date +\%F).sql.gz") | crontab -
mkdir -p /srv/backups
```

## 9. Troubleshooting

| Symptom                                               | Cause                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Browser console: `NEXT_PUBLIC_APP_URL … is undefined` | Built without the build args. `wwc up -d --build app` with the vars set in `.env.prod`.                     |
| Page loads, but nothing live (no WS)                  | `NEXT_PUBLIC_WS_URL` scheme mismatch — `wss://` on an HTTPS page, `ws://` on HTTP. Rebuild after fixing.    |
| Redirect loop to https                                | nginx sending `X-Forwarded-Proto: http`. The HTTP-only conf deliberately omits that header; don't add it.   |
| Login works, session drops                            | `NEXTAUTH_URL` doesn't match the origin in the address bar, or `NEXTAUTH_SECRET` changed.                   |
| `nginx: cannot load certificate`                      | `NGINX_CONF=app-ssl.conf` before certbot issued the cert. Switch back to `app-http.conf`, issue, then swap. |
| Build OOM-killed                                      | Add swap (step 1), or build the image elsewhere and `docker save`/`load` it.                                |
| `prisma migrate deploy` says drift                    | The DB predates the baseline: `npx prisma migrate resolve --applied 0_init`.                                |

## Known gaps (deliberate, not blockers)

- **`.env.production` is committed to the repo** with localhost values and a dummy secret. Docker
  never sees it (`.dockerignore`), but a _non-Docker_ `next build` would load it ahead of `.env` and
  silently bake `http://localhost:3000` into the bundle. Worth `git rm --cached .env.production`.
- **`deployment/main.tf`** is the old, unfinished AWS/Terraform attempt. It is unrelated to this
  stack; ignore or delete it.
- No CDN/object storage: sprites and CO art are served by Next from `public/`.
