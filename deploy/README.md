# Axistra Portal — VPS Deployment

## One-time setup on the VPS

```bash
ssh root@axistratech.com
cd /opt/axistra
git clone https://github.com/<your-org>/Axistra-Web-Portal.git
cd Axistra-Web-Portal
cp deploy/update.sh /opt/axistra/update.sh
chmod +x /opt/axistra/update.sh
docker compose up -d
```

That bootstraps everything (Postgres + backend-nest + frontend + nginx).

## Day-to-day workflow

Whenever you finish a chat with the Emergent agent:

1. In the chat input, click **"Save to Github"** — Emergent pushes the new code
   to your repo's `emergent` branch.
2. SSH into the VPS and run the one-liner:

   ```bash
   bash /opt/axistra/update.sh
   ```

   You can also run it remotely without logging in interactively:

   ```bash
   ssh root@axistratech.com 'bash /opt/axistra/update.sh'
   ```

That's it. The script will:

- Take a safety `pg_dump` snapshot into `/opt/axistra/backups/pre-update-*.dump.gz`
  (set `BACKUP_BEFORE=no` to skip).
- `git fetch` + `git reset --hard origin/emergent`.
- Detect which images changed (backend-nest / frontend) and rebuild **only those**.
- Roll the containers with `docker compose up -d --no-deps`.
- Health-check the backend on `:9001/api/health`.
- Prune dangling images.

If nothing changed, the script exits immediately with `Already at <sha>`.

## Common overrides

```bash
# Use a different branch (e.g. when QA'ing a feature branch):
BRANCH=feature/foo bash /opt/axistra/update.sh

# Skip the pre-update pg_dump (faster):
BACKUP_BEFORE=no bash /opt/axistra/update.sh

# Force-rebuild EVERYTHING even if no files changed:
docker compose build --no-cache && docker compose up -d
```

## Rolling back

```bash
# 1. Restore the previous snapshot:
ls -lt /opt/axistra/backups/ | head    # find the most recent pre-update-*.dump.gz
gunzip -c /opt/axistra/backups/pre-update-YYYYMMDD-HHMMSS.dump.gz \
  | docker compose exec -T postgres pg_restore --clean --if-exists -U axistra -d axistra_db

# 2. Roll back the code to the previous commit:
cd /opt/axistra/Axistra-Web-Portal
git log --oneline -5             # pick the prior commit SHA
git reset --hard <prior-sha>
docker compose build backend-nest frontend
docker compose up -d backend-nest frontend
```
