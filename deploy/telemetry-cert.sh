#!/usr/bin/env bash
# Gets or renews the Let's Encrypt certificate for the telemetry hostname and installs it for fleet-telemetry.
#
#   sudo deploy/telemetry-cert.sh telemetry.example.com [email]
#
# The email is optional. Let's Encrypt stopped sending expiry reminders on 2025-06-04 and now only adds
# addresses to its mailing list (letsencrypt.org/2025/06/26/expiration-notification-service-has-ended).
#
# Uses a Cloudflare DNS challenge, so port 80 stays with Caddy. Needs a Cloudflare API token with
# Zone:DNS:Edit in /root/.secrets/cloudflare.ini (override with CLOUDFLARE_INI), mode 600:
#   dns_cloudflare_api_token = <token>
# Safe to run from cron: certbot only renews within 30 days of expiry, and fleet-telemetry restarts only when
# the certificate changed.
set -euo pipefail

HOST=${1:?usage: telemetry-cert.sh <telemetry hostname> [email]}
EMAIL=${2:-}
CREDS=${CLOUDFLARE_INI:-/root/.secrets/cloudflare.ini}
DEPLOY=$(cd "$(dirname "$0")" && pwd)
OUT=$DEPLOY/config/telemetry
LIVE=/etc/letsencrypt/live/$HOST

[ -r "$CREDS" ] || { echo "Missing $CREDS (see the comment at the top of this script)." >&2; exit 1; }
mkdir -p "$OUT"

if [ -n "$EMAIL" ]; then account=(-m "$EMAIL"); else account=(--register-unsafely-without-email); fi
docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v "$CREDS:/cloudflare.ini:ro" certbot/dns-cloudflare \
  certonly --non-interactive --agree-tos "${account[@]}" --keep-until-expiring \
  --dns-cloudflare --dns-cloudflare-credentials /cloudflare.ini --dns-cloudflare-propagation-seconds 30 -d "$HOST"

if cmp -s "$LIVE/fullchain.pem" "$OUT/server-cert.pem"; then
  echo "Certificate unchanged."
  exit 0
fi

install -m 644 "$LIVE/fullchain.pem" "$OUT/server-cert.pem"
# fleet-telemetry's image runs as distroless "nonroot" (uid 65532), so the key must belong to that uid.
install -m 600 -o 65532 -g 65532 "$LIVE/privkey.pem" "$OUT/server-key.pem"

# ca.pem goes into the car's telemetry config. Let's Encrypt rotates between several intermediates on each
# renewal (letsencrypt.org/certificates), so include all of them plus the roots; then a renewal doesn't
# require sending a new config to the car.
tmp=$(mktemp)
for c in isrgrootx1 isrg-root-x2 gen-y/root-ye gen-y/root-yr \
         gen-y/int-ye1 gen-y/int-ye2 gen-y/int-ye3 gen-y/int-yr1 gen-y/int-yr2 gen-y/int-yr3; do
  curl -fsS "https://letsencrypt.org/certs/$c.pem" >> "$tmp"
done
cat "$LIVE/chain.pem" >> "$tmp"
install -m 644 "$tmp" "$OUT/ca.pem"
rm -f "$tmp"

if docker compose -f "$DEPLOY/docker-compose.yml" --env-file "$DEPLOY/../.env" ps --status running -q fleet-telemetry | grep -q .; then
  docker compose -f "$DEPLOY/docker-compose.yml" --env-file "$DEPLOY/../.env" restart fleet-telemetry
fi
echo "Installed certificate for $HOST in $OUT."
