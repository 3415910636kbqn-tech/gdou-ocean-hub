#!/usr/bin/env bash
set -euo pipefail

# One-time setup for permanent automatic Let's Encrypt SSL renewal via Cloudflare DNS-01.
# Usage: sudo bash /opt/gdou-ocean-hub/scripts/setup-ssl-autorenew.sh <CLOUDFLARE_DNS_API_TOKEN>
TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  echo "Usage: sudo bash $0 <CLOUDFLARE_DNS_API_TOKEN>"
  exit 1
fi

apt-get update -qq && apt-get install -y -qq python3-certbot-dns-cloudflare
cat << EOF > /etc/letsencrypt/cloudflare-gdou.ini
dns_cloudflare_api_token = ${TOKEN}
EOF
chmod 600 /etc/letsencrypt/cloudflare-gdou.ini

certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare-gdou.ini \
  --dns-cloudflare-propagation-seconds 20 \
  --non-interactive --agree-tos --register-unsafely-without-email \
  --force-renewal \
  -d gdou.capqinal666888.online \
  --deploy-hook "systemctl reload nginx"

echo "SSL auto-renewal configured! Testing dry-run..."
certbot renew --dry-run
