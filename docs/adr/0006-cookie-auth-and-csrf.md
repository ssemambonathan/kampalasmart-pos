# ADR 0006 — Cookie sessions, CSRF and refresh rotation

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

The browser app needs a session that survives page reloads, works with the Next.js proxy, and does
not expose long-lived credentials to JavaScript. The system also serves a PWA and shared tills where
stolen tokens are a realistic threat.

## Decision

- Authenticate with an access JWT (default 15 minutes) in an `httpOnly` cookie `ks_at`.
- Issue a random refresh token stored only as a SHA-256 hash in `Session.tokenHash`, in an
  `httpOnly` cookie `ks_rt` scoped to `/api`.
- Rotate the refresh token on every refresh: revoke the old session row, create a new one. Reuse of
  a revoked token revokes the entire session family and is audited.
- Protect cookie-authenticated mutations with a double-submit CSRF token (`ks_csrf` cookie +
  `x-csrf-token` header, timing-safe comparison). Bearer-authenticated requests are exempt.
- Use `SameSite=Lax`, `Secure` in production, and an explicit CORS origin allow-list.
- Lock an account for 15 minutes after 5 failed passwords and rate-limit login per IP+email.

## Consequences

- Tokens are never readable by application JavaScript, reducing the impact of XSS on token theft.
- CSRF is handled without server-side token storage; the browser must send the header on mutations.
- Refresh rotation means a stolen refresh token is detectable through reuse, at the cost of extra
  session rows.
- The session table must be pruned occasionally; revoked rows are retained for detection until
  cleanup.
- Logout and password reset revoke sessions promptly.

## Alternatives considered

- Access token in `localStorage`: rejected — readable by XSS and harder to revoke.
- Stateless JWT-only sessions: rejected — no immediate revocation on logout, role change or
  suspension.
- Server-side CSRF token store: unnecessary for the double-submit model here; adds state.
- OAuth/OIDC provider: out of scope; local accounts are required for the target market.
