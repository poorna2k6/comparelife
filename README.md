# CompareLife

Compare where to live and retire using real, cited data.

## Launch (free resources)

    scripts/launch.sh local    # local Postgres (Docker) + dev server
    scripts/launch.sh hosted   # free Neon Postgres + dev server
    scripts/launch.sh deploy   # Neon + Vercel free tier production deploy

Individual steps: `scripts/setup.sh`, `db-local.sh`, `db-hosted.sh`, `db-migrate.sh`, `deploy-vercel.sh`.
