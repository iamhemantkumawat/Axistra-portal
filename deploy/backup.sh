#!/usr/bin/env bash
# Axistra Portal — Encrypted PostgreSQL nightly backup.
#
# Usage:
#   1. Set required env vars in /etc/axistra/backup.env (template below).
#   2. Place this script at /opt/axistra/backup.sh and chmod +x.
#   3. Add to crontab (root):  0 3 * * * /opt/axistra/backup.sh >> /var/log/axistra-backup.log 2>&1
#
# Backup pipeline:
#   pg_dump --format=custom  →  gzip  →  gpg --symmetric --cipher-algo AES256  →  uploaded to remote (optional)
#
# Restore (manual):
#   gpg --decrypt axistra_db-YYYY-MM-DD.dump.gz.gpg | gunzip | pg_restore -d axistra_db
#
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/axistra/backup.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${DB_HOST:=localhost}"
: "${DB_PORT:=5432}"
: "${DB_NAME:=axistra_db}"
: "${DB_USER:=axistra}"
: "${PGPASSWORD:?Set PGPASSWORD in $ENV_FILE}"
: "${GPG_PASSPHRASE:?Set GPG_PASSPHRASE in $ENV_FILE (used as symmetric key)}"
: "${BACKUP_DIR:=/var/backups/axistra}"
: "${RETENTION_DAYS:=14}"
: "${UPLOAD_DESTINATION:=}"   # e.g. s3://bucket/path  OR  rclone:remote:path

mkdir -p "$BACKUP_DIR"
export PGPASSWORD

DATE=$(date -u +%Y-%m-%dT%H%M%SZ)
DUMP_FILE="$BACKUP_DIR/${DB_NAME}-${DATE}.dump"
ENC_FILE="${DUMP_FILE}.gz.gpg"

echo "[$(date -Is)] axistra-backup: dumping $DB_NAME ..."
pg_dump --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
        --format=custom --no-owner --no-acl "$DB_NAME" > "$DUMP_FILE"

echo "[$(date -Is)] axistra-backup: encrypting ..."
gzip -c "$DUMP_FILE" | \
  gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "$GPG_PASSPHRASE" \
      --output "$ENC_FILE"
rm -f "$DUMP_FILE"

SIZE=$(du -h "$ENC_FILE" | cut -f1)
echo "[$(date -Is)] axistra-backup: created $ENC_FILE ($SIZE)"

# Optional: ship offsite
if [[ -n "$UPLOAD_DESTINATION" ]]; then
  echo "[$(date -Is)] axistra-backup: uploading to $UPLOAD_DESTINATION ..."
  if [[ "$UPLOAD_DESTINATION" == s3://* ]]; then
    aws s3 cp "$ENC_FILE" "$UPLOAD_DESTINATION/" --sse AES256
  elif [[ "$UPLOAD_DESTINATION" == rclone:* ]]; then
    rclone copy "$ENC_FILE" "${UPLOAD_DESTINATION#rclone:}"
  else
    echo "Unknown UPLOAD_DESTINATION scheme; skipping upload."
  fi
fi

# Retention: prune local files older than RETENTION_DAYS
find "$BACKUP_DIR" -type f -name "${DB_NAME}-*.dump.gz.gpg" -mtime +"$RETENTION_DAYS" -print -delete

echo "[$(date -Is)] axistra-backup: done."
