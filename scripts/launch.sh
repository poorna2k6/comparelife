#!/usr/bin/env bash
# Usage: scripts/launch.sh [local|hosted|deploy]
#   local  – local Postgres + dev server (default)
#   hosted – free Neon DB + dev server
#   deploy – hosted DB + Vercel production deploy
. "$(dirname "$0")/lib.sh"
MODE=${1:-local}
"$(dirname "$0")/setup.sh"
case "$MODE" in
  local)  "$(dirname "$0")/db-local.sh"; sleep 5 ;;
  hosted|deploy) "$(dirname "$0")/db-hosted.sh" ;;
  *) echo "Unknown mode: $MODE" >&2; exit 1 ;;
esac
. "$(dirname "$0")/lib.sh"   # reload .env
"$(dirname "$0")/db-migrate.sh"
if [ "$MODE" = deploy ]; then "$(dirname "$0")/deploy-vercel.sh"; else npm run dev; fi
