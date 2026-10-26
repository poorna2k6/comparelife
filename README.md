# FitPot 🏆

Fitness challenges for friends with money (or just points) on the line.

1. **Organiser** creates a challenge: what to track (steps, calories, workout minutes, km, or anything custom),
   duration (1 week / month / year), entry fee, and a **stay-in line** (e.g. 50 % of the leader's total).
2. **Friends join** by invite link/code before the start date and pay; the organiser confirms each payment.
3. Everyone **logs** daily numbers; a live leaderboard shows who is safe and who is at risk. Friends can flag
   suspicious entries; the organiser can remove them. Everything is recorded in a tamper-proof history.
4. When it ends, anyone below the line **forfeits their stake**; the pot is shared among those who stayed in -
   **in proportion to what they achieved** (or equally) - plus they get their own stake back.

FitPot does not move money today: the organiser holds the pot and the app computes exact payouts, tracks each
transfer in an append-only ledger and shows "reconciled" when the pot is fully paid out.

> ⚠️ Pooling and redistributing stakes may be regulated as gambling in your country. Read
> [docs/LAUNCH.md](docs/LAUNCH.md) before enabling real money (`ALLOW_REAL_MONEY`).

## Run

Node 22.13+, no dependencies.

```
npm start            # http://localhost:3000
npm test             # unit + API + security tests
docker compose up    # production-style (see .env.example)
```

Docs: [architecture & security model](docs/ARCHITECTURE.md) · [launch checklist](docs/LAUNCH.md)
