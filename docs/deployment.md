# Deployment

This repository ships a production-oriented Docker Compose stack: PostgreSQL 16, Redis 7, a
migration job, the NestJS API and the Next.js web app. It is a single-region reference deployment,
not a managed cloud platform. TLS termination, WAF, secrets management and multi-AZ are operator
responsibilities described below.

The stack was built and started locally on 26 October 2026; see [Verification](#verification).

## Topology

```
Internet
   │ HTTPS
   ▼
Reverse proxy (Caddy/Nginx/ALB) ──► web :3000 (Next.js, loopback-bound)
                                      │ /api/backend/* rewrite
                                      ▼
                                   api :4000 (NestJS, internal only)
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                   postgres :5432             redis :6379
                   (only on the               (rate limits,
                    compose network)           readiness)
```

- Only the web port is published, and only on `127.0.0.1`.
- The API, database and Redis are reachable only on the compose network.
- `migrate` runs `prisma migrate deploy` once, before the API starts.
- API and web containers run as the unprivileged `node` user with
  `no-new-privileges:true`.

## Prerequisites

- Docker Engine 24+ with Compose v2 (verified with Docker 29.7.2 / Compose v5.4.0).
- A host with at least 2 GB RAM and 10 GB free disk for images and database growth.
- A DNS name and TLS certificate if the instance is public.

## Configure

```bash
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32          # use as JWT_ACCESS_SECRET
```

Required values:

| Variable | Notes |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Use a long alphanumeric password or URL-encode it in `DATABASE_URL` |
| `DATABASE_URL` | Must use the compose hostname `postgres`, not `localhost` |
| `JWT_ACCESS_SECRET` | At least 32 random characters; rotating it invalidates access tokens |
| `WEB_ORIGIN` | Exact public origin, e.g. `https://pos.example.com`; CORS allow-list |
| `COOKIE_SECURE` | `true` behind HTTPS; `false` only for local HTTP drills |
| `COOKIE_DOMAIN` | Leave empty for host-only cookies, or set the registrable domain |
| `API_INTERNAL_URL` | Must be `http://api:4000` inside compose |
| `REDIS_URL` | `redis://redis:6379` in compose; required for shared rate limiting |
| `TRUST_PROXY` | Number of trusted proxy hops (usually `1` behind Caddy/Nginx) |
| `WEB_PORT` | Host loopback port, default `3000` |

`EMAIL_PROVIDER` only supports `development-outbox`. Other values log a warning and do not deliver.
There is no payment provider configuration because none is implemented.

## Build and start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Expected: `postgres` and `redis` healthy, `migrate` exited 0, `api` healthy, `web` healthy.

Check:

```bash
curl -fsS http://127.0.0.1:${WEB_PORT:-3000}/login > /dev/null && echo "web OK"
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>{console.log(r.status);process.exit(r.ok?0:1)})"
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=50 api
```

Do **not** run `npm run db:seed` in a real deployment. The seed creates demo tenants with known
passwords and past-dated financial history. It is not part of the runtime or migration image;
seed only an isolated demo/staging database you can reach with a host checkout, or create the first
business through `/register`.

The `api` runtime image contains production dependencies only. A separate small `migrate` image
carries the Prisma CLI and the migration files, then exits; it is not used to serve traffic.

## TLS and reverse proxy

Terminate TLS before the web container and forward to `127.0.0.1:3000`. Caddy example (not included
in the compose file, not exercised by this repository):

```caddyfile
pos.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
  }
}
```

Then set:

```dotenv
WEB_ORIGIN=https://pos.example.com
COOKIE_SECURE=true
TRUST_PROXY=1
```

Notes:

- Keep the app's own security headers; do not strip `Content-Security-Policy` or `X-Frame-Options`.
- The browser talks only to the web origin. The Next.js rewrite proxies `/api/backend/*` to the API,
  so the API does not need a public hostname.
- If the proxy is another container, attach it to the compose network and proxy to `web:3000`
  instead of changing the loopback binding casually.
- Restrict direct access to the host port with a firewall; the compose binding is loopback-only.

## Migrations

- Deploy applies committed migrations with `prisma migrate deploy` in the `migrate` service.
- Migrations are forward-only. A rollback is a new migration plus a restore from backup if data was
  affected.
- Before a schema-changing release: take a backup, test `migrate deploy` against a restored copy,
  then deploy. The API refuses to start if its migration job fails.
- Never use `prisma migrate dev` against production; it can reset data.

## Scaling and limits

- Run **one** API replica with this compose file. `migrate` assumes a one-off execution.
- For more replicas: run migrations as a separate job outside request handling, ensure every API
  instance shares `REDIS_URL`, and put a load balancer in front. The in-memory rate-limit fallback
  is per process.
- PostgreSQL is a single instance. Use a managed database with automated backups for production.
- No object storage, queue, external cache or CDN is configured. The app is stateless apart from
  the database, Redis and the browser's IndexedDB.
- Uploaded files do not exist; product import is CSV text.

## Backups

Use the provided scripts against the running compose stack (see [operations.md](operations.md)
for the drill evidence):

```bash
# Production compose
COMPOSE_FILE=docker-compose.prod.yml ENV_FILE=.env.production ./scripts/backup.sh

# Restore into a scratch database first
RESTORE_CONFIRM=yes COMPOSE_FILE=docker-compose.prod.yml ENV_FILE=.env.production \
  ./scripts/restore.sh backups/kampalasmart-....dump kampalasmart_restore_drill
```

Backups are custom-format `pg_dump` files written with mode `0600` to `./backups` (git-ignored).
Encrypt and copy them off-host; the scripts do not upload anything. Keep at least 30 daily backups
and test a restore monthly.

## Secrets

- Keep `.env.production` out of git (ignored) and out of images (`.dockerignore` excludes `.env*`).
- Use a secret manager or Docker secrets in a real environment; the compose file uses environment
  variables for portability.
- Rotate `JWT_ACCESS_SECRET` to revoke all access tokens immediately; refresh sessions remain valid
  until revoked. Rotate the database password and update `DATABASE_URL` together.
- The seed's demo passwords must never reach a public instance.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs three jobs:

1. **quality** — install, shared build, lint, typecheck, unit tests, Next.js production build.
2. **integration** — PostgreSQL + Redis services, creates `kampalasmart_test`, runs 42 API tests.
3. **e2e** — migrates and seeds a disposable database, builds and starts both apps, installs
   Chromium, runs the 3 Playwright smoke tests and uploads traces/screenshots on failure.

The workflow has not been executed on GitHub from this workspace; its commands mirror the local
verification below.

## Verification

Executed on 26 October 2026 on Windows 11 with Docker 29.7.2 / Compose v5.4.0:

- `docker compose -f docker-compose.prod.yml --env-file .env.production config --quiet` — valid.
- All three images built from the repository root: `kampalasmart-api:local` (858 MB),
  `kampalasmart-web:local` (1.77 GB, includes the Next.js production dependencies) and
  `kampalasmart-migrate:local` (858 MB). The API build pins `target: runtime`; the Dockerfile also
  keeps `runtime` as the last stage so a plain `docker build` produces the API image. This was fixed
  after the first attempt tagged the migration stage as the API image (symptom: the API container
  ran `prisma migrate deploy` in a restart loop and failed its health check).
- `docker compose ... up -d` — the `migrate` container exited 0 after applying all migrations;
  `postgres` and `redis` became healthy; `api` passed `/health/ready`; `web` passed its `/login`
  health check. Only `127.0.0.1:3100` was published in this drill.
- The fresh database contained 0 businesses, 0 users and 0 products before registration.
- A new business was registered through the containerised UI at `http://127.0.0.1:3100/register`
  (`Nakawa Fresh Produce`, owner `Aisha Nakawa`), followed by automatic sign-in and a dashboard
  greeting: `Good evening, Aisha`. The two `401` responses observed in the browser console were the
  expected pre-authentication probes to `auth/me` and `auth/refresh`.
- After registration the database held exactly 1 business, 1 user, 1 location and 0 products. The
  seeded demo account `owner@mirembe.test` was rejected with `401 UNAUTHENTICATED`, confirming that
  no demo data is baked into the images or migrations.
- `scripts/backup.sh` produced a 112 KB custom-format dump from the compose database, and
  `scripts/restore.sh` restored it into a scratch database. Source and restored row counts matched
  exactly (`Business 1, User 1, Location 1, Product 0, Sale 0, InventoryMovement 0, AuditLog 2`).
  The scratch database and drill volumes were then removed.
- The stack was stopped with `docker compose down` (volumes retained by default). No seed is run in
  the production path.

The exact commands and outcomes are repeated in
[ENGINEERING_REPORT.md](ENGINEERING_REPORT.md).
