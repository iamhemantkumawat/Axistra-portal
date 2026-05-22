# Cloudflare Setup — Axistra Compliance Portal

Cloudflare sits in front of the Nginx instance on your Ubuntu VPS and provides DNS, free SSL, DDoS protection, WAF rules, and bot mitigation.

## 1. DNS Records

Sign in to Cloudflare → your zone (`axistratech.com`) → **DNS → Records**.

| Type | Name                  | Content (VPS IP)  | Proxy status   |
|------|-----------------------|-------------------|----------------|
| A    | `portal`              | `YOUR.VPS.IP.HERE`| Proxied 🟧     |
| A    | `axistratech.com` (apex if needed) | `YOUR.VPS.IP.HERE` | Proxied 🟧 |

> **Proxied (orange cloud) is required** so traffic flows through Cloudflare. Grey cloud = DNS-only and bypasses all protection.

## 2. SSL/TLS

`SSL/TLS → Overview` → set encryption mode to **Full (strict)**.

Then on the VPS run:
```bash
sudo certbot --nginx -d portal.axistratech.com --email ops@axistratech.com --agree-tos --no-eff-email
```
Certbot will edit `/etc/nginx/sites-available/axistra.conf` and install Let's Encrypt certificates. Cloudflare's "Full (strict)" requires a valid origin cert — Let's Encrypt is accepted.

(Alternative: generate a 15-year Cloudflare Origin Certificate in `SSL/TLS → Origin Server` and pin it to your origin IP. Reload nginx after installing.)

`SSL/TLS → Edge Certificates` →
- Always Use HTTPS: **On**
- Automatic HTTPS Rewrites: **On**
- Minimum TLS Version: **1.2**
- HSTS: **On** (max-age 6 months, includeSubdomains, preload — only enable once you're sure HTTPS works)

## 3. Firewall / WAF

`Security → WAF → Custom rules` — recommended baseline:

| Rule name              | Expression                                                                                                  | Action     |
|------------------------|-------------------------------------------------------------------------------------------------------------|------------|
| Block non-UAE/EU       | `(ip.geoip.country ne "AE" and ip.geoip.country ne "GB" and ip.geoip.country ne "US")`                      | Managed Challenge |
| Block known bad bots   | `(cf.client.bot)`                                                                                           | Block      |
| Rate-limit /api/auth   | `(http.request.uri.path eq "/api/auth/login")`                                                              | Rate limit: 5 per 1 minute → Block 10 minutes |
| Protect /api           | `(http.request.uri.path matches "^/api/" and ip.src ne 0.0.0.0/0)` (combine with allowlist if internal only)| Managed Challenge |

`Security → Bots` → Enable **Bot Fight Mode** (free) or **Super Bot Fight Mode** (paid).

`Security → DDoS` → Defaults are already strict; leave as-is.

## 4. Page Rules / Cache

`Caching → Configuration` → Browser Cache TTL: **4 hours**.
`Rules → Page Rules`:
- `portal.axistratech.com/api/*` → Cache Level: **Bypass** (never cache API)
- `portal.axistratech.com/*.{js,css,png,jpg,svg,woff2}` → Cache Level: **Cache Everything**, Edge Cache TTL: **1 month**

## 5. Origin Lockdown

Allow only Cloudflare IPs to reach your VPS so attackers can't bypass the proxy:

```bash
# Get the current Cloudflare IP list
curl -s https://www.cloudflare.com/ips-v4 > /tmp/cf-v4.txt
curl -s https://www.cloudflare.com/ips-v6 > /tmp/cf-v6.txt

# Allow Cloudflare on 80/443 only
sudo ufw default deny incoming
sudo ufw allow 22/tcp                  # keep SSH — better: restrict by source IP
while read ip; do sudo ufw allow from "$ip" to any port 80,443 proto tcp; done < /tmp/cf-v4.txt
while read ip; do sudo ufw allow from "$ip" to any port 80,443 proto tcp; done < /tmp/cf-v6.txt
sudo ufw enable
```

Schedule a weekly cron to refresh Cloudflare IPs.

## 6. Monitoring

- `Analytics → Traffic` for request volumes.
- `Analytics → Security` for blocked threats & WAF events.
- Set an email alert in `Notifications` for "Origin Error Rate" so you know when the VPS is unreachable.

## 7. Test

```bash
curl -I https://portal.axistratech.com           # expect 200 + cf-ray header
curl -I https://portal.axistratech.com/api/health
```

If `cf-ray` header is missing, DNS is still grey-clouded — re-enable the proxy.
