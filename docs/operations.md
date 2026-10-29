# Operations runbook

Operational procedures for the Docker Compose deployment. Commands assume the repository root and
a production env file; adjust names if your deployment differs.

```bash
alias kc='docker compose -f docker-compose.prod.yml --env-file .env.production'
kc ps
kc logs -f --tail=100 api
```

## Service map

| Service | Role | Health |
| --- | --- | --- |
| `web` | Next.js UI and API proxy | `GET /login` returns 200 |
| `api` | NestJS API | `GET /health/ready` returns 200 |
| `postgres` | Source of truth | `pg_isready` |
| `redis` | Shared rate limiting and optional cache | `redis-cli ping` |
| `migrate` | One-shot `prisma migrate deploy` | exit code 0 |

`/health/ready` checks the database and a writable storage directory. Redis is reported in
`checks.redis` but does not make readiness fail: without Redis the API falls back to in-memory rate
limiting. Treat `redis: UNHEALTHY` as a warning, `database: UNHEALTHY` or HTTP 503 as an incident.

## Routine checks

**Daily**

- `kc ps` — all long-running services `Up (healthy)`.
- `curl -fsS http://127.0.0.1:3000/login > /dev/null` — web reachable.
- `kc exec api node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>{console.log(r.status);process.exit(r.ok?0:1)})"`
- `kc logs --since=24h api | grep -iE '"level":"(error|warn)"'` — review unexpected errors.
- Confirm last night's backup exists and is non-zero.
- In the UI: `/sync` for open conflicts; `/notifications` for low stock.

**Weekly**

- Run a restore drill into a scratch database (below).
- Review `/audit` for role changes, refund approvals, sync conflict resolutions and repeated 403s.
- Check disk usage: `docker system df`, database size with
  `kc exec postgres psql -U kampala -d kampalasmart -c "SELECT pg_size_pretty(pg_database_size('kampalasmart'));"`.

**Monthly**

- Patch base images (`docker compose ... build --pull`) and redeploy in a maintenance window.
- Rotate seeded/demo accounts out of any shared environment.
- Review access: active users, roles, assigned branches, stale sessions.

## Logs and request tracing

- Logs are JSON from `AppLogger`; errors include the request ID, user ID and business ID when
  authenticated.
- Every API response includes `X-Request-Id`; clients see the same value in `error.requestId`.
- Filter one request: `kc logs api | grep '<request-id>'`.
- Do not paste tokens, cookies, passwords or full customer data into tickets. Audit logs already
  redact sensitive keys.

## Restart and deploy

```bash
# Update code and rebuild
git pull
kc build
kc up -d
kc ps

# Restart one service
kc restart api

# Stop without deleting data
kc down
```

`kc down -v` deletes the database and Redis volumes. Do not use it on a real deployment unless you
intend to destroy all data.

Deployment order is enforced by compose: Postgres healthy → migration completes → API healthy →
web starts. If `migrate` exits non-zero, the API will not start. Read its logs before retrying;
never delete the volume to "fix" a failed migration.

## Backup and restore

### Backup

```bash
COMPOSE_FILE=docker-compose.prod.yml ENV_FILE=.env.production ./scripts/backup.sh
```

- Writes `backups/<db>-<UTC timestamp>.dump` with mode `0600`.
- Retention defaults to 30 days; override `RETENTION_DAYS`.
- Copy backups off-host immediately and encrypt at rest. The script does not upload.

Example cron (02:15 daily, keep 30 days):

```cron
15 2 * * * cd /srv/kampalasmart && COMPOSE_FILE=docker-compose.prod.yml ENV_FILE=.env.production ./scripts/backup.sh >> /var/log/kampalasmart-backup.log 2>&1
```

### Restore drill (non-destructive)

Restore into a scratch database, verify row counts, then drop the scratch database. Never point the
API at the scratch DB.

```bash
# 1. Pick the newest dump
ls -lt backups | head

# 2. Restore into kampalasmart_restore_drill
RESTORE_CONFIRM=yes COMPOSE_FILE=docker-compose.prod.yml ENV_FILE=.env.production \
  ./scripts/restore.sh backups/kampalasmart-YYYYMMDDTHHMMSSZ.dump kampalasmart_restore_drill

# 3. Compare key counts with production
kc exec postgres psql -U kampala -d kampalasmart_restore_drill -c \
  'SELECT (SELECT COUNT(*) FROM "Sale") AS sales, (SELECT COUNT(*) FROM "InventoryMovement") AS movements, (SELECT COUNT(*) FROM "AuditLog") AS audit;'
kc exec postgres psql -U kampala -d kampalasmart -c \
  'SELECT (SELECT COUNT(*) FROM "Sale") AS sales, (SELECT COUNT(*) FROM "InventoryMovement") AS movements, (SELECT COUNT(*) FROM "AuditLog") AS audit;'

# 4. Drop the scratch database (only after verification)
kc exec postgres dropdb -U kampala kampalasmart_restore_drill
```

A real restore replaces the target database. Take a fresh backup first, stop the API to prevent
writes, restore, start the API, then sign in and verify dashboard totals, recent sales and stock.

### What a backup contains

Everything in PostgreSQL: tenants, users (hashed passwords), sessions, catalogue, ledger, sales,
refunds, purchases, transfers, audit rows and tokens. Treat dumps as highly sensitive. Redis and
IndexedDB queues are not included; unsynced till data lives only on the device.

## Incident procedures

### API returns 5xx or readiness is 503

1. `kc ps` and `kc logs --tail=200 api`.
2. If the database is down, see below.
3. If storage is unhealthy, confirm the container can write `storage/` (the image creates it owned by
   `node`). A full disk is the usual cause: `docker system df`, host disk usage.
4. If the API is crash-looping after a release, check the `migrate` exit code and logs. Roll back the
   image only if the schema change is backward compatible; otherwise restore the backup.
5. Confirm `/health/live` still responds to distinguish a process failure from a database failure.

### Database unavailable

- The API returns 5xx for writes; PostgreSQL transactions roll back, so there are no half-posted
  sales.
- Offline tills keep queuing sales locally with increasing attempt counts. Do not ask staff to clear
  browser data, and do not reinstall the PWA while sales are unsynced.
- Start Postgres (`kc up -d postgres`) and wait for healthy. Prisma reconnects without an API
  restart in normal cases; restart `api` if errors persist.
- If the volume is lost, restore the latest dump before bringing the API back. Any sales that synced
  after the backup are lost from the server; the audit/device records cannot recreate them.

### Redis unavailable

- Rate limiting falls back to a per-process in-memory limiter, so protection continues on a single
  API instance but is weaker if scaled.
- Readiness still returns 200 if the database and storage are healthy.
- Restart Redis (`kc restart redis`); rate-limit counters reset, which is acceptable.

### Sync conflicts and backlog

- `/sync` (requires `sync:manage`) lists devices and conflicts.
- Conflict reasons include insufficient stock, unavailable product, invalid/inactive customer.
- Resolve only after checking current stock and the customer record; the resolution text is audited.
  A conflict is preserved, never silently deleted.
- If a till has a large pending queue, keep it online and let the outbox drain in batches of 40.
  Network failures reset events to `PENDING` and increment attempts; they are retried.
- If a device is lost with unsynced sales, those sales cannot be recovered from the server. Record
  the loss and reconcile stock if needed.

### Stock does not match the shelf

1. Check `/inventory/product/:id/ledger` for the movement history.
2. Count physical stock.
3. Use **Reconcile** with a reason; this appends a `COUNT` movement, it does not rewrite history.
4. Never edit the database directly. If a data corruption is suspected, preserve the database and
   audit export before making changes.

### Wrong sale, wrong payment or refund mistake

- A completed sale is never edited or deleted.
- Create a refund for the wrong amount/tender. If it is already completed, record a new corrective
  refund only within policy; both remain visible in reports and audit.
- Refund amounts at or above the threshold need another approver. Owners can approve their own but
  the action is audited — use a second person whenever possible.

### Locked or departed staff

- Locked account: `/users` → Unlock (owner), or wait 15 minutes. Repeated lockouts are a signal to
  review audit history.
- Departing staff: deactivate the user, revoke their sessions, and reconsider their branch access.
  Do not delete financial records they created.
- Suspected credential compromise: revoke sessions, change the password, rotate
  `JWT_ACCESS_SECRET`, review `/audit` and export it. There is no MFA; assume a stolen password is
  usable until changed.

### Demo data in a live environment

If seeded accounts were deployed by mistake:

1. Take a backup.
2. Deactivate or delete (soft-delete) the demo users through `/users`; do not remove their sales.
3. Remove the second demo tenant only if it contains no needed data; otherwise leave it isolated.
4. Rotate any secrets that were shared alongside the demo credentials.
5. Confirm login fails for every seeded address.

## Known operational gaps

- No metrics endpoint, alerting or log aggregation is bundled. Add an external uptime check against
  `/health/ready` and ship JSON logs to your logging platform.
- No automated session pruning job. Expired/revoked session rows can be archived after your
  retention window with a reviewed SQL job; audit rows should not be deleted.
- No automated backup upload/encryption. Off-host copy is the operator's responsibility.
- No multi-region failover, read replicas or PITR configuration is included.
- Email delivery is a development outbox, so password recovery is manual unless you integrate a
  provider.
