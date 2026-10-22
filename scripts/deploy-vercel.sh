#!/usr/bin/env bash
# Deploy to Vercel (free Hobby plan). Needs `vercel login` once.
. "$(dirname "$0")/lib.sh"
: "${DATABASE_URL:?Set DATABASE_URL in .env (must be a hosted DB, not localhost)}"
npx --yes vercel@latest login
npx --yes vercel@latest link --yes
printf '%s' "$DATABASE_URL" | npx --yes vercel@latest env add DATABASE_URL production
npx --yes vercel@latest deploy --prod
