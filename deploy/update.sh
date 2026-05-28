#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Axistra Portal — Production update script
# ---------------------------------------------------------------------------
# Run this on your VPS after pushing new code to GitHub (`Save to Github` in the
# Emergent chat). It pulls the latest commit, rebuilds the changed Docker
# images and rolls the containers safely.
#
# One-time install on the VPS:
#   sudo install -m 0755 update.sh /opt/axistra/update.sh
#
# Usage:
#   ssh root@axistratech.com 'cd /opt/axistra/Axistra-Web-Portal && bash /opt/axistra/update.sh'
#
# Or interactively on the box:
#   cd /opt/axistra/Axistra-Web-Portal && bash /opt/axistra/update.sh
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/axistra/Axistra-Web-Portal}"
BRANCH="${BRANCH:-emergent}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
BACKUP_BEFORE="${BACKUP_BEFORE:-yes}"   # set BACKUP_BEFORE=no to skip pg_dump
LOG_PREFIX="[axistra-update]"

log()  { printf '\033[36m%s\033[0m %s\n' "$LOG_PREFIX" "$*"; }
ok()   { printf '\033[32m%s\033[0m %s\n' "$LOG_PREFIX" "$*"; }
warn() { printf '\033[33m%s\033[0m %s\n' "$LOG_PREFIX" "$*"; }
die()  { printf '\033[31m%s ERROR:\033[0m %s\n' "$LOG_PREFIX" "$*" >&2; exit 1; }

[[ -d "$REPO_DIR" ]] || die "Repo directory $REPO_DIR not found. Edit REPO_DIR at the top of this script."
cd "$REPO_DIR"

# --- 1. Optional Postgres safety backup --------------------------------------
if [[ "$BACKUP_BEFORE" == "yes" ]]; then
  log "Taking a safety pg_dump before pulling…"
  BACKUP_DIR="/opt/axistra/backups"
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  if docker compose -f "$COMPOSE_FILE" ps postgres >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" exec -T postgres \
      pg_dump -U axistra -d axistra_db -F c \
      | gzip > "$BACKUP_DIR/pre-update-${STAMP}.dump.gz" \
      && ok  "Backup saved to $BACKUP_DIR/pre-update-${STAMP}.dump.gz" \
      || warn "Backup failed — continuing anyway. Roll back with the previous backup if needed."
  else
    warn "No postgres container detected — skipping backup. Set BACKUP_BEFORE=no to silence."
  fi
fi

# --- 2. Pull latest code -----------------------------------------------------
log "Fetching origin/${BRANCH}…"
git fetch origin "$BRANCH"
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/${BRANCH}")"

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
  ok "Already at $LOCAL_SHA — nothing to do."
  exit 0
fi

log "Resetting workdir to origin/${BRANCH}…"
git reset --hard "origin/${BRANCH}"
ok  "Now at $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

# --- 3. Detect what changed and rebuild only those services ------------------
CHANGED="$(git diff --name-only "$LOCAL_SHA" "$REMOTE_SHA")"
REBUILD_BACKEND=no
REBUILD_FRONTEND=no
SCHEMA_TOUCHED=no
COMPOSE_TOUCHED=no
echo "$CHANGED" | grep -qE '^backend-nest/'  && REBUILD_BACKEND=yes
echo "$CHANGED" | grep -qE '^frontend/'      && REBUILD_FRONTEND=yes
echo "$CHANGED" | grep -qE '^backend-nest/src/(entities|migrations)/' && SCHEMA_TOUCHED=yes
echo "$CHANGED" | grep -qE '^(docker-compose\.yml|deploy/)' && COMPOSE_TOUCHED=yes

[[ "$COMPOSE_TOUCHED" == "yes" ]] && { REBUILD_BACKEND=yes; REBUILD_FRONTEND=yes; }

log "Changes: backend=$REBUILD_BACKEND  frontend=$REBUILD_FRONTEND  schema=$SCHEMA_TOUCHED"

# --- 4. Rebuild ---------------------------------------------------------------
BUILD_TARGETS=()
[[ "$REBUILD_BACKEND"  == "yes" ]] && BUILD_TARGETS+=("backend-nest")
[[ "$REBUILD_FRONTEND" == "yes" ]] && BUILD_TARGETS+=("frontend")

if [[ ${#BUILD_TARGETS[@]} -eq 0 ]]; then
  ok "No backend/frontend changes — restart not required."
else
  log "Rebuilding: ${BUILD_TARGETS[*]}"
  docker compose -f "$COMPOSE_FILE" build "${BUILD_TARGETS[@]}"
  log "Rolling: ${BUILD_TARGETS[*]}"
  docker compose -f "$COMPOSE_FILE" up -d --no-deps "${BUILD_TARGETS[@]}"
fi

# --- 5. Health check ----------------------------------------------------------
log "Waiting for backend health…"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:9001/api/health >/dev/null 2>&1 \
     || curl -fsS http://127.0.0.1:8001/api/health >/dev/null 2>&1; then
    ok "Backend healthy."
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && warn "Health endpoint did not respond in 60s — check 'docker compose logs backend-nest'."
done

# --- 6. Prune unused images (keeps disk in check) ----------------------------
log "Pruning dangling images…"
docker image prune -f >/dev/null || true

ok  "Update complete — running at $(git rev-parse --short HEAD)"
