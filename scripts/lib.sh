#!/usr/bin/env bash
# Shared helpers: load .env into the environment.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1 — $2" >&2; exit 1; }; }
