# Architecture

```
public/           static SPA (no build step, strict CSP: no inline scripts)
server.js         process entry: wiring, signals, graceful shutdown
src/app.js        composition root (config, logger, db, service, http)
src/http.js       transport: cookies, CSRF header, rate limits, security headers, request logs, static files
src/routes.js     URL -> service call (thin)
src/service.js    ALL business rules: accounts, challenges, payments, ledger, audit
src/settle.js     pure payout maths (integer minor units, largest-remainder rounding)
src/payments.js   payment-provider boundary (manual today; Stripe/Razorpay later)
src/migrations.js versioned, append-only schema migrations
```

## Money model

* All money is integer minor units (paise/cents). Progress is integer hundredths. No floats in settlement.
* A member is "in" only with a **confirmed payment**. Unpaid members cannot log and are not counted.
* `ledger` is an append-only table (enforced by DB triggers). Confirming a payment writes `stake_in`; sending a
  payout writes `payout_out`; undoing either writes a reversal. The balance for a challenge is what the organiser
  should still hold; after every payout is sent it must be **exactly 0** - the app shows "reconciled ✓".
* `audit_log` is also trigger-protected and records every score or money change with actor and IP.
* Settlement is a single DB transaction and happens once; entries lock afterwards.
* Fewer than `MIN_PARTICIPANTS` paid members at settlement -> everyone is refunded rather than "losing to nobody".
* Cancelling before start refunds all confirmed payments.

## Security model

* Sessions: random 256-bit token in an `HttpOnly; SameSite=Strict; Secure` cookie; only its SHA-256 is stored;
  30-day expiry; logout and password reset revoke server-side.
* CSRF: SameSite=Strict **plus** a required `X-Requested-With` header on every mutation.
* Passwords: scrypt with per-user salt, 8+ chars; constant-time compare with a dummy hash for unknown users.
* Throttling: per-IP global limit, per-(IP,name) login limit, limits on register / reset / create / log.
  The limiter is in-memory (single instance); move it to Redis before running several instances.
* Headers: strict CSP (`script-src 'self'`), HSTS in production, frame denial, no-referrer, nosniff.
* Privacy: emails never leave the server; data export and account deletion endpoints exist.
* Authorisation is checked in the service layer on every call; non-members get 404, not 403.

## Scaling notes

SQLite (WAL) on one instance comfortably serves thousands of users. Everything touching the DB is inside
`src/db.js` + `src/service.js`, with plain SQL, so moving to PostgreSQL means swapping the driver and
`tx()`, not rewriting business rules. Do that when you need >1 app instance or managed backups/PITR.
