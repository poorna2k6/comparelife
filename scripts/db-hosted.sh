#!/usr/bin/env bash
# Free hosted Postgres on Neon (free tier). Needs a one-time `neonctl auth` login.
. "$(dirname "$0")/lib.sh"
need npx "install Node.js"
npx --yes neonctl@latest auth
PROJECT_JSON=$(npx --yes neonctl@latest projects create --name comparelife --output json)
URL=$(echo "$PROJECT_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.connection_uris[0].connection_uri)})')
grep -v '^DATABASE_URL=' .env 2>/dev/null > .env.tmp || true
echo "DATABASE_URL=$URL" >> .env.tmp && mv .env.tmp .env
echo "DATABASE_URL written to .env"
