# FitPot 🏆

Fitness challenges for friends with money on the line.

1. **Organiser** creates a challenge: what to track (steps, calories, workout minutes, km, or any custom metric), duration (1 week / month / year), entry fee, and a **stay-in line** (e.g. 50 % of the leader's total).
2. **Friends join** with a short invite code (before the start date) and pay the entry fee; the organiser confirms each payment.
3. Everyone **logs** their numbers daily; a live leaderboard shows who is safe and who is at risk.
4. When it ends, anyone below the stay-in line **forfeits their stake**. The forfeited pot is shared among everyone who stayed in - **in proportion to what they achieved** (or equally, your choice) - on top of getting their own stake back.

FitPot does not move money. It tracks who has paid, computes exact payouts (integer cents, largest-remainder rounding, total payouts always equal the pot), and lets the organiser mark each payout as sent. Entries are visible to everyone, can be capped per day, and are locked once the organiser settles.

## Run

Requires Node 22.13+ (uses built-in `node:sqlite`; no dependencies).

```
npm start        # http://localhost:3000   (PORT, DB_PATH env vars)
npm test
```

## Layout

- `lib/settle.js` - pure payout engine (tested)
- `lib/dates.js`, `lib/db.js` - date maths, SQLite schema
- `server.js` - HTTP API + static files
- `public/` - mobile-first single-page UI
