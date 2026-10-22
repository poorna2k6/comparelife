#!/usr/bin/env bash
# Apply the Prisma schema to the database in DATABASE_URL.
. "$(dirname "$0")/lib.sh"
: "${DATABASE_URL:?Set DATABASE_URL in .env}"
npx prisma db push
