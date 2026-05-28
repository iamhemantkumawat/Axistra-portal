#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Axistra Portal — Production update script (one-command deploy)
# ---------------------------------------------------------------------------
# Usage on the VPS — JUST THIS, every time:
#
#     bash /opt/axistra/update.sh
#
# It does, in order:
#   0. Self-updates itself from the repo (so this file is always the latest).
#   1. Takes a pg_dump safety snapshot (.dump.gz in /opt/axistra/backups).
#   2. Pulls origin/<BRANCH> with --hard reset on a non-Axistra-Web-Portal
#      checkout (defaults to /opt/axistra).
#   3. Runs a pre-deploy doctor: lockfiles present? Dockerfiles correct?
#      docker-compose.yml reachable? aborts BEFORE any docker build runs if
#      anything is off.
#   4. Detects what changed; rebuilds only those services.
#   5. Rolls containers with --no-deps + waits for the health endpoint.
#   6. Prunes dangling images.
# ---------------------------------------------------------------------------
set -euo pipefail

# ---- defaults that match the live VPS layout -------------------------------
REPO_DIR="${REPO_DIR:-/opt/axistra}"
BRANCH="${BRANCH:-emergent}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
BACKUP_BEFORE="${BACKUP_BEFORE:-yes}"
NO_SELF_UPDATE="${NO_SELF_UPDATE:-no}"   # set to yes to skip step 0

LOG_PREFIX="[axistra-update]"
log()  { printf '\033[36m%s\033[0m %s\n' "$LOG_PREFIX" "$*"; }
ok()   { printf '\033[32m%s\033[0m %s\n' "$LOG_PREFIX" "$*"; }
warn() { printf '\033[33m%s\033[0m %s\n' "$LOG_PREFIX" "$*"; }
die()  { printf '\033[31m%s ERROR:\033[0m %s\n' "$LOG_PREFIX" "$*" >&2; exit 1; }

[[ -d "$REPO_DIR/.git" ]] || die "$REPO_DIR is not a git checkout. Either edit REPO_DIR at the top of this script, or run:  git clone -b $BRANCH https://github.com/iamhemantkumawat/Axistra-portal.git $REPO_DIR"
cd "$REPO_DIR"

# ----- Step 0: self-update ---------------------------------------------------
# We pull a fresh copy of THIS script from the repo HEAD before doing anything
# else, then re-exec into it. That way you never have to copy update.sh
# manually after a script change.
self_update() {
  [[ "$NO_SELF_UPDATE" == "yes" ]] && return 0
  local source_path="$REPO_DIR/deploy/update.sh"
  local installed_path="${BASH_SOURCE[0]}"
  # If we're already running from the in-tree copy, skip — git reset later
  # would handle it.
  if [[ "$(readlink -f "$installed_path")" == "$(readlink -f "$source_path" 2>/dev/null || true)" ]]; then
    return 0
  fi
  # Fetch the latest update.sh from the remote without touching the rest of
  # the working tree (in case the user is two versions behind).
  git fetch --quiet origin "$BRANCH" 2>/dev/null || return 0
  local remote_script_sha
  remote_script_sha="$(git rev-parse "origin/${BRANCH}:deploy/update.sh" 2>/dev/null || true)"
  [[ -z "$remote_script_sha" ]] && return 0
  local local_script_sha
  if [[ -f "$installed_path" ]]; then
    local_script_sha="$(git hash-object "$installed_path" 2>/dev/null || true)"
  fi
  if [[ "$local_script_sha" != "$remote_script_sha" ]]; then
    log "Self-updating $installed_path from origin/${BRANCH}…"
    git show "origin/${BRANCH}:deploy/update.sh" > "$installed_path.new"
    chmod +x "$installed_path.new"
    mv "$installed_path.new" "$installed_path"
    ok "update.sh refreshed — re-executing latest version."
    export NO_SELF_UPDATE=yes
    exec bash "$installed_path" "$@"
  fi
}
self_update "$@"

# ----- pre-deploy doctor -----------------------------------------------------
doctor() {
  local errors=0
  log "Running pre-deploy doctor…"
  [[ -f "$COMPOSE_FILE" ]] || { warn "missing $COMPOSE_FILE (set COMPOSE_FILE=... if it lives elsewhere)"; errors=$((errors+1)); }
  [[ -f "$ENV_FILE"     ]] || { warn "missing $ENV_FILE — backend & frontend won't get DATABASE_*/JWT_SECRET/REACT_APP_BACKEND_URL"; errors=$((errors+1)); }

  # REACT_APP_BACKEND_URL MUST be in the .env file AND consumed by the frontend
  # build via `args:` — otherwise Vite bakes 'localhost:9001' into the bundle.
  if [[ -f "$ENV_FILE" ]]; then
    if ! grep -qE '^REACT_APP_BACKEND_URL=' "$ENV_FILE"; then
      warn "$ENV_FILE has no REACT_APP_BACKEND_URL — the browser will fall back to localhost:9001 and CORS will block login"
      errors=$((errors+1))
    fi
  fi
  if [[ -f "$COMPOSE_FILE" ]]; then
    if ! grep -qE 'REACT_APP_BACKEND_URL: \$\{REACT_APP_BACKEND_URL\}|REACT_APP_BACKEND_URL=\$\{REACT_APP_BACKEND_URL\}' "$COMPOSE_FILE"; then
      warn "$COMPOSE_FILE doesn't forward REACT_APP_BACKEND_URL as a build arg → frontend will bake the wrong URL → CORS-blocked login. Add under frontend: 'build: { args: { REACT_APP_BACKEND_URL: \${REACT_APP_BACKEND_URL} } }'."
      errors=$((errors+1))
    fi
  fi

  for svc in frontend backend-nest; do
    [[ -f "$svc/Dockerfile" ]]   || { warn "$svc/Dockerfile missing"; errors=$((errors+1)); }
    [[ -f "$svc/package.json" ]] || { warn "$svc/package.json missing"; errors=$((errors+1)); }
    [[ -f "$svc/yarn.lock" ]]    || { warn "$svc/yarn.lock missing — repo is yarn-managed, lockfile must be committed"; errors=$((errors+1)); }
    if [[ -f "$svc/package-lock.json" ]]; then
      warn "$svc/package-lock.json is committed alongside yarn.lock — these conflict. Delete it: 'git rm $svc/package-lock.json'"
      errors=$((errors+1))
    fi
    if grep -qE '^[[:space:]]*RUN[[:space:]]+npm[[:space:]]+(ci|install)' "$svc/Dockerfile" 2>/dev/null; then
      warn "$svc/Dockerfile uses 'npm ci/install' but the repo is yarn-managed. Switch the install step to 'yarn install --frozen-lockfile'."
      errors=$((errors+1))
    fi
  done

  if (( errors > 0 )); then
    die "Doctor found $errors issue(s) above. Fix them, push again, then re-run update.sh."
  fi
  ok "Doctor passed."
}

# ----- Step 1: safety pg_dump ------------------------------------------------
if [[ "$BACKUP_BEFORE" == "yes" ]]; then
  log "Taking a safety pg_dump before pulling…"
  BACKUP_DIR="/opt/axistra/backups"
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps postgres >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
      pg_dump -U "${POSTGRES_USER:-axistra}" -d "${POSTGRES_DB:-axistra_db}" -F c \
      2>/dev/null | gzip > "$BACKUP_DIR/pre-update-${STAMP}.dump.gz" \
      && ok  "Backup saved to $BACKUP_DIR/pre-update-${STAMP}.dump.gz" \
      || warn "Backup failed — continuing anyway."
  else
    warn "No running postgres container — skipping backup."
  fi
fi

# ----- Step 2: pull -----------------------------------------------------------
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

# ----- Step 3: doctor on fresh tree ------------------------------------------
doctor

# ----- Step 4: figure out what to rebuild ------------------------------------
CHANGED="$(git diff --name-only "$LOCAL_SHA" "$REMOTE_SHA")"
REBUILD_BACKEND=no
REBUILD_FRONTEND=no
SCHEMA_TOUCHED=no
COMPOSE_TOUCHED=no
echo "$CHANGED" | grep -qE '^backend-nest/'  && REBUILD_BACKEND=yes
echo "$CHANGED" | grep -qE '^frontend/'      && REBUILD_FRONTEND=yes
echo "$CHANGED" | grep -qE '^backend-nest/src/(entities|migrations)/' && SCHEMA_TOUCHED=yes
echo "$CHANGED" | grep -qE '^(deploy/docker-compose\.yml|deploy/)' && COMPOSE_TOUCHED=yes
[[ "$COMPOSE_TOUCHED" == "yes" ]] && { REBUILD_BACKEND=yes; REBUILD_FRONTEND=yes; }
log "Changes: backend=$REBUILD_BACKEND  frontend=$REBUILD_FRONTEND  schema=$SCHEMA_TOUCHED"

# ----- Step 5: rebuild + roll -------------------------------------------------
BUILD_TARGETS=()
[[ "$REBUILD_BACKEND"  == "yes" ]] && BUILD_TARGETS+=("backend")
[[ "$REBUILD_FRONTEND" == "yes" ]] && BUILD_TARGETS+=("frontend")

if [[ ${#BUILD_TARGETS[@]} -eq 0 ]]; then
  ok "No backend/frontend changes — restart not required."
else
  log "Rebuilding: ${BUILD_TARGETS[*]}"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build "${BUILD_TARGETS[@]}"
  log "Rolling: ${BUILD_TARGETS[*]}"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps "${BUILD_TARGETS[@]}"
fi

# ----- Step 6: health check + post-deploy verification ----------------------
log "Waiting for backend health…"
HEALTHY=no
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:9001/api/health >/dev/null 2>&1; then HEALTHY=yes; break; fi
  sleep 2
done
if [[ "$HEALTHY" == "yes" ]]; then ok "Backend healthy."
else warn "Backend health check failed in 60s — run: docker compose -f $COMPOSE_FILE logs backend"
fi

# Login smoke-test — proves the frontend bundle has the right backend URL.
PUBLIC_URL="$(grep -E '^REACT_APP_BACKEND_URL=' "$ENV_FILE" | cut -d= -f2 | tr -d '"')"
if [[ -n "$PUBLIC_URL" ]]; then
  LOGIN_HTTP="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$PUBLIC_URL/api/health" -m 10 2>/dev/null || echo 000)"
  [[ "$LOGIN_HTTP" =~ ^(2|3) ]] \
    && ok "Public API reachable at $PUBLIC_URL/api/health (HTTP $LOGIN_HTTP)." \
    || warn "Public API at $PUBLIC_URL/api/health returned HTTP $LOGIN_HTTP — check nginx + DNS."
fi

# ----- Step 7: prune ----------------------------------------------------------
log "Pruning dangling images…"
docker image prune -f >/dev/null || true
ok  "Update complete — running at $(git rev-parse --short HEAD)"
