#!/usr/bin/env bash
# Install deps, create .env if absent, generate Prisma client.
. "$(dirname "$0")/lib.sh"
[ -f .env ] || { cp .env.example .env; echo "Created .env from .env.example"; }
npm ci
npx prisma generate
echo "Setup done."
