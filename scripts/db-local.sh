#!/usr/bin/env bash
# Free local Postgres: Docker if available, otherwise a locally installed postgres.
. "$(dirname "$0")/lib.sh"
if command -v docker >/dev/null 2>&1; then
  docker rm -f comparelife-db >/dev/null 2>&1 || true
  docker run -d --name comparelife-db -p 5432:5432 \
    -e POSTGRES_USER=comparelife -e POSTGRES_PASSWORD=comparelife -e POSTGRES_DB=comparelife \
    -v comparelife-pgdata:/var/lib/postgresql/data postgres:16
  echo "Postgres starting on localhost:5432"
elif command -v pg_ctlcluster >/dev/null 2>&1 || command -v psql >/dev/null 2>&1; then
  need psql "install PostgreSQL"
  sudo -u postgres psql -c "CREATE USER comparelife WITH PASSWORD 'comparelife' CREATEDB;" || true
  sudo -u postgres psql -c "CREATE DATABASE comparelife OWNER comparelife;" || true
  echo "Using installed Postgres; database 'comparelife' ready."
else
  echo "Neither Docker nor Postgres found. Use scripts/db-hosted.sh for a free hosted DB." >&2; exit 1
fi
