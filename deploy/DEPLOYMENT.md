# Axistra Compliance + Accounting Portal — Ubuntu VPS Deployment Guide

This guide walks through deploying the portal on a fresh **Ubuntu 22.04 LTS** VPS with Docker, Nginx (host-level), Cloudflare in front, encrypted nightly backups, and Let's Encrypt SSL.

> **Target topology**
>
> ```
> Browser ⇄ Cloudflare (DDoS/WAF/SSL) ⇄ Nginx (host) ⇄ Docker stack
>                                                       ├─ frontend  (port 3000)
>                                                       ├─ backend   (NestJS, 9001)
>                                                       ├─ postgres  (5432, internal)
>                                                       └─ redis     (internal)
> ```

---

## 1. Provision the VPS

Recommended specs: 2 vCPU / 4 GB RAM / 40 GB SSD / Ubuntu 22.04 LTS.

```bash
ssh root@your.vps.ip
adduser axistra
usermod -aG sudo axistra
rsync --archive --chown=axistra:axistra ~/.ssh /home/axistra
exit
ssh axistra@your.vps.ip
```

## 2. System packages

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install nginx certbot python3-certbot-nginx ufw fail2ban \
    gnupg gzip postgresql-client-15 curl wget rsync git
```

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version && docker compose version
```

## 4. Pull the codebase

```bash
sudo mkdir -p /opt/axistra && sudo chown $USER /opt/axistra
cd /opt/axistra
git clone https://github.com/<your-org>/axistra-portal.git .   # or rsync the /app folder
```

## 5. Configure environment files

```bash
cp backend-nest/.env.example backend-nest/.env
nano backend-nest/.env       # set DB password, JWT_SECRET, MAGNUS creds, SEED admin
```

Frontend env (used at build time):

```bash
echo "REACT_APP_BACKEND_URL=https://portal.axistratech.com" > frontend/.env.production
```

Create root `.env` for docker compose:

```bash
cat > .env <<EOF
DATABASE_USER=axistra
DATABASE_PASSWORD=$(openssl rand -base64 24)
DATABASE_NAME=axistra_db
DATABASE_HOST=postgres
DATABASE_PORT=5432
JWT_SECRET=$(openssl rand -hex 48)
SEED_ADMIN_EMAIL=admin@axistratech.com
SEED_ADMIN_PASSWORD=$(openssl rand -base64 16)
MAGNUS_API_KEY=...
MAGNUS_API_SECRET=...
MAGNUS_PUBLIC_URL=https://cyberxcalls.com/mbilling
REACT_APP_BACKEND_URL=https://portal.axistratech.com
EOF
chmod 600 .env
```

> ⚠️ Save the generated `SEED_ADMIN_PASSWORD` immediately — you'll change it on first login.

## 6. Bring up the stack

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
docker compose logs -f backend     # verify "Axistra NestJS API listening"
```

Confirm:
```bash
curl http://127.0.0.1:9001/api/health     # {"status":"healthy",...}
curl http://127.0.0.1:3000                # serves React build
```

## 7. Configure host Nginx

```bash
sudo cp /opt/axistra/deploy/nginx.conf /etc/nginx/sites-available/axistra.conf
sudo sed -i 's/portal.axistratech.com/your.actual.host/g' /etc/nginx/sites-available/axistra.conf
sudo ln -s /etc/nginx/sites-available/axistra.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 8. SSL with Let's Encrypt

```bash
sudo certbot --nginx -d portal.axistratech.com \
     --email ops@axistratech.com --agree-tos --no-eff-email --redirect
sudo systemctl enable --now certbot.timer
```

## 9. Firewall (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Lock down `80/443` to Cloudflare IPs only — see `deploy/cloudflare-setup.md` section 5.

## 10. Cloudflare in front

Follow `deploy/cloudflare-setup.md` (DNS proxied, SSL Full Strict, WAF rules, rate limits, origin lockdown).

## 11. Encrypted nightly backups

```bash
sudo mkdir -p /opt/axistra/scripts /etc/axistra /var/backups/axistra
sudo cp /opt/axistra/deploy/backup.sh /opt/axistra/scripts/
sudo cp /opt/axistra/deploy/backup.env.example /etc/axistra/backup.env
sudo chmod 700 /etc/axistra && sudo chmod 600 /etc/axistra/backup.env
sudo nano /etc/axistra/backup.env       # fill DB password + GPG passphrase
sudo chmod +x /opt/axistra/scripts/backup.sh

# Run once to verify
sudo /opt/axistra/scripts/backup.sh

# Schedule daily 03:00 UTC
( sudo crontab -l 2>/dev/null; echo "0 3 * * * /opt/axistra/scripts/backup.sh >> /var/log/axistra-backup.log 2>&1" ) | sudo crontab -
```

Restore drill:
```bash
gpg --decrypt /var/backups/axistra/axistra_db-YYYY-...gpg \
  | gunzip \
  | docker compose exec -T postgres pg_restore -U axistra -d axistra_db --clean --if-exists
```

## 12. Fail2Ban (SSH brute-force protection)

```bash
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

## 13. Health monitoring

Add a tiny uptime check (e.g. UptimeRobot, Better Uptime, Healthchecks.io) against:
- `https://portal.axistratech.com/api/health`
- `https://portal.axistratech.com/`

## 14. First-time login

1. Visit `https://portal.axistratech.com/login`
2. Sign in as the seed admin (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
3. **Immediately** go to **Admin Users**, create your real admin account, then disable / change the seed user.
4. Go to **Customers** and add your first customer to validate the full chain.

## 15. Common operations

| Task                            | Command                                                                 |
|---------------------------------|-------------------------------------------------------------------------|
| View backend logs               | `docker compose logs -f backend`                                        |
| View frontend build             | `docker compose logs -f frontend`                                       |
| Restart backend                 | `docker compose restart backend`                                        |
| Apply code update               | `git pull && docker compose up -d --build`                              |
| Manual DB shell                 | `docker compose exec postgres psql -U axistra axistra_db`               |
| Manual backup                   | `sudo /opt/axistra/scripts/backup.sh`                                   |
| Rotate JWT secret               | Edit `.env`, restart `backend` (all users will be logged out)           |
| Reset seed admin password       | Edit `.env` `SEED_ADMIN_PASSWORD`, `docker compose restart backend`     |

## 16. Production hardening checklist

- [ ] Replace seed admin & disable initial account
- [ ] Strong `JWT_SECRET` (≥ 48 random hex bytes)
- [ ] Strong DB password (rotated quarterly)
- [ ] Cloudflare proxy enabled (orange cloud)
- [ ] WAF custom rules in place (rate-limit `/api/auth/login`)
- [ ] UFW firewall restricting 80/443 to CF IPs
- [ ] Fail2Ban active
- [ ] Nightly encrypted backups verified by quarterly restore drill
- [ ] GPG passphrase stored in a password manager (not on the server)
- [ ] Offsite backup destination configured (S3 / R2 / Backblaze B2)
- [ ] Auto-renew working: `sudo certbot renew --dry-run`
- [ ] Logs shipping somewhere durable (CloudWatch / Logtail / etc.)
- [ ] Time-sync correct: `timedatectl status` → NTP active
- [ ] `docker compose pull && up -d` runs weekly (e.g. via cron) for base-image patches

---

## Troubleshooting

| Symptom                                    | Likely cause / fix                                                      |
|--------------------------------------------|--------------------------------------------------------------------------|
| 502 Bad Gateway from Nginx                 | Backend container down → `docker compose logs backend`                  |
| Login returns 401 immediately              | `JWT_SECRET` changed without restarting backend                         |
| Magnus calls always fail                   | Verify `MAGNUS_PUBLIC_URL`, API key/secret, and that VPS can reach host |
| Invoice PDF returns HTML instead of PDF    | Chromium missing in backend image → rebuild with the provided Dockerfile|
| KYC upload says "Unsupported file type"    | Allowed extensions: pdf, png, jpg, jpeg, webp                           |
| Backups disk filling                       | Lower `RETENTION_DAYS` in `/etc/axistra/backup.env`                     |

Need anything else? Check `/var/log/syslog`, `docker compose logs`, and the **Audit Logs** page inside the portal itself.
