# November 2026 Security Incident

## Findings

The reviewed November 14 logs recorded successful administrator logins from an
unrecognized source, successful database-backup downloads, and restore requests
using an invalid uploaded archive. The administrator password in the reviewed
backups matched the configured default seed password. This strongly supports
default-credential compromise; the logs do not establish how the password was
obtained. Backup routes were authenticated, not anonymous.

The old restore implementation committed a schema drop before importing the
replacement dump. A failed import could therefore leave the database empty.
The backup downloads establish database disclosure, not merely an attempted
attack. Reviewed dumps contained customer and financial records, password
hashes, and a Google Drive refresh token. Absence of another integration key in
those dumps does not establish that it was never exposed elsewhere.

## Code Protections

- Never reset existing staff passwords at startup. Bootstrap only an empty
  staff table with an explicitly supplied strong password; remove default CA
  creation and default passwords.
- Check JWT subjects against active database users and their current roles.
  Reject purpose-specific challenge tokens as API sessions and require the
  completed second-factor claim for users with 2FA enabled.
- Require the administrator role for staff-management endpoints.
- Validate KYC customer IDs, filenames, and filesystem entries; reject symlinks
  and paths outside the expected customer directory.
- Register only the restricted backup controller. Require authentication,
  administrator role, and verified 2FA for backup metadata and creation.
  Do not register browser download, upload, restore, or OAuth callback routes.
- Rate-limit manual backups and publish completed private snapshots only after
  both pg_dump and gzip streaming succeed. Ignore symlinks in snapshot listings.
- Load Drive OAuth credentials from a private server-mounted file, not the
  application settings table. Return only sanitized Drive status to the UI.
- Include the synchronized backend dependency lockfile and IPv4 health check.

## Operational Actions (Not Stored In Git)

The database was recovered from a valid backup. Staff passwords and the JWT
signing secret were rotated, invalidating previous sessions. The observed
source IP was blocked at the host firewall. Google Drive was reconnected using
replacement credentials and an owner-only backup folder. Production secrets,
passwords, database dumps, and customer documents must not be committed.

## Deployment And Verification

Preserve the production environment and private secret mounts when updating.
Drive OAuth requires `/app/secrets/google-drive-oauth.json`, a regular file
with mode 0600, containing client_id, client_secret, and refresh_token, plus the
configured GOOGLE_DRIVE_FOLDER_ID. Authorize and provision it server-side;
do not re-enable the old public callback or backup controller.

Build the backend, then run `node --test tests/security-hardening.test.cjs`
from backend-nest with its dependencies installed. Build the frontend normally.
Verify unauthenticated backup requests return 401, removed backup operations
remain unavailable, and privileged access requires verified 2FA.

This is containment and targeted hardening, not proof the whole host is clean.
Downloaded information cannot be recalled. Continue integration-key review,
log monitoring, and SSH hardening. The retained operator restore helper is not
an atomic database replacement and must never be re-exposed as a web route;
test recovery against an isolated database before any production restore.
