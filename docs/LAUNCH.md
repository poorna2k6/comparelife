# Launch checklist

Status legend: ✅ done in this repo · ⛔ **blocking** before taking real money · 🔧 needed before public launch

## ⛔ 1. Legal & regulatory (do first - not a coding task)

FitPot pools entry fees and redistributes them based on performance. In many jurisdictions that can be treated as
gambling / a prize contest / an online money game, and *holding other people's money* can require a licence.
**Get advice from a lawyer in each launch country before enabling real money.** Things to ask specifically:

* India: the Promotion and Regulation of Online Gaming Act, 2025 restricts online money games, and skill-based
  contests are not necessarily exempt. State laws and RBI payment-aggregator rules also apply to holding funds.
* USA: state skill-contest / gambling laws, FinCEN/state money-transmitter rules for holding funds.
* EU/UK: gambling and e-money/payment-services rules; consumer-law and GDPR obligations.
* App stores and payment processors (Stripe, Razorpay, Apple, Google) restrict or ban pooled-stake products.

Lower-risk launch options: ship **points-only** (`ALLOW_REAL_MONEY=false`, already supported), or forfeit to a
charity / a sponsor-funded prize pool instead of redistributing between players, or keep settlement strictly
off-platform between friends (what the manual provider does today - FitPot never holds funds).

## ✅ / 🔧 2. Product & engineering

| Item | State |
|---|---|
| Config via env, structured logs, request ids, health/readiness probes, graceful shutdown | ✅ |
| Versioned migrations; DB constraints; append-only ledger + audit log | ✅ |
| Secure sessions, CSRF, rate limits, login throttling, CSP, password reset, export/delete account | ✅ |
| Money reconciliation, refunds, cancel, min-participant refund, daily cap, entry flagging | ✅ |
| Docker image + compose + CI running tests and building the image | ✅ |
| Real email transport (SMTP/SES/Postmark) in `src/mailer.js` - today it only logs | 🔧 |
| Email verification on sign-up (reset flow exists; verification does not) | 🔧 |
| Payment gateway provider + webhook + automated payouts (see `src/payments.js`) and KYC via the provider | 🔧 (⛔ for real money at scale) |
| Dispute workflow beyond "flag + organiser removes" (e.g. appeal, admin override, support tooling) | 🔧 |
| Verified data sources (Apple Health / Google Fit / Strava sync) to remove self-reporting cheating | 🔧 |
| Admin back-office and abuse/fraud monitoring | 🔧 |
| PostgreSQL + managed backups/PITR before multiple instances; Redis rate limiter | 🔧 |
| Error tracking (Sentry etc.), metrics, uptime alerts; log shipping | 🔧 |
| Real Terms & Privacy text (current pages are marked PLACEHOLDER), cookie/consent review, age gate | ⛔ |
| Accessibility audit (labels, focus, contrast done at baseline), i18n for target languages | 🔧 |
| Load test, penetration test, backup-restore drill | 🔧 |
| Native/PWA wrapper and push notifications ("you're about to drop below the line") | 🔧 |

## Running in production

```
cp .env.example .env     # set APP_URL, keep ALLOW_REAL_MONEY=false until section 1 is done
docker compose up -d --build
```
Terminate TLS in front (Caddy/nginx/ALB), set `TRUST_PROXY=true`, back up the `/data` volume (`sqlite3 .backup`
or Litestream) and watch `/readyz`.
