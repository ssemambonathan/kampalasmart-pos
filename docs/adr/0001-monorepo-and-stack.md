# ADR 0001 — Monorepo, Next.js and NestJS

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

The product needs an offline-capable till, a management back office, a typed API and shared
financial rules. Shipping three separately versioned codebases would let client and server pricing
drift — the exact failure mode that creates disputed receipts.

## Decision

Use one npm-workspaces monorepo:

- `apps/api` — NestJS 11, Prisma 6, PostgreSQL 16, Redis 7.
- `apps/web` — Next.js 15/React 19 PWA with Dexie.
- `packages/shared` — CommonJS TypeScript package containing Decimal money helpers, the pricing
  engine, permission matrix, plan definitions, sync types and DTO schemas.

The API and web both import the same pricing function. The web is compiled as a normal Next.js
production server; the API and web are separate containers.

## Consequences

- One install, one lint/typecheck/test pipeline, one lockfile.
- Pricing changes are reviewed once and cannot silently diverge between client and server.
- The shared package must be built before the apps (`npm run build:shared`).
- Deployment is two images plus PostgreSQL and Redis; no shared runtime coupling.
- The monorepo does not imply a shared database between web and API; the web never talks to
  PostgreSQL directly.

## Alternatives considered

- Separate repositories: rejected for coordination overhead and duplicated domain logic.
- A single Next.js app with API routes: rejected because background-safe transactions, guards,
  Swagger and long-running jobs are clearer in Nest, and because a separate API can serve future
  clients.
- GraphQL: rejected as unnecessary for a CRUD/reporting surface where OpenAPI and typed clients are
  sufficient.
