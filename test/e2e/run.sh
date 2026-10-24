#!/usr/bin/env bash
# End-to-end test of the production stack without the real car:
#   fake car --mTLS--> tesla/fleet-telemetry --MQTT--> mosquitto --> app --SSE--> PWA (Chromium)
#   app --HTTPS--> tesla-http-proxy --> fake Fleet API      app --web push--> fake push service
# Uses deploy/docker-compose.yml as is, plus test/e2e/compose.e2e.yml. Needs Docker, Node 22, openssl
# and Playwright with Chromium. Writes test/e2e/results/ (report.md, report.json, logs).
#   test/e2e/run.sh            run and tear down
#   KEEP=1 test/e2e/run.sh     leave the stack running afterwards
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
export VIN=${VIN:-5YJSA1E6XPF000001}   # made-up VIN, valid length
RESULTS=$HERE/results
WORK=$(mktemp -d "${TMPDIR:-/tmp}/plaid-e2e.XXXXXX")
rm -rf "$RESULTS" && mkdir -p "$RESULTS"

# Work on a copy so the test never touches your .env or deploy/config.
( cd "$REPO" && git ls-files -z --cached --others --exclude-standard | xargs -0 cp --parents -t "$WORK" )
export E2E_CERTS=$WORK/e2e-certs
"$HERE/gen-certs.sh" "$WORK/deploy" "$E2E_CERTS" "$VIN"
cp "$HERE/scenario.json" "$E2E_CERTS/"

# Production fleet-telemetry config + trust for the test car CA (a real car chains to Tesla's CA,
# which fleet-telemetry has built in).
node -e '
  const fs = require("fs");
  const c = JSON.parse(fs.readFileSync(process.argv[1]));
  c.tls.ca_file = "/e2e/car-ca.pem";
  fs.writeFileSync(process.argv[2], JSON.stringify(c, null, 2));
' "$WORK/deploy/fleet-telemetry/config.json" "$E2E_CERTS/fleet-telemetry.json"

VAPID=$(cd "$REPO" && node scripts/gen-vapid.js)
cat > "$WORK/.env" <<ENV
PORT=8080
PUBLIC_URL=http://127.0.0.1:18080
APP_DOMAIN=e2e.example.com
APP_PASSCODE=e2e-passcode
SESSION_SECRET=$(openssl rand -hex 32)
SAMPLE_MODE=0
VIN=$VIN
TESLA_CLIENT_ID=e2e-client-id
TESLA_CLIENT_SECRET=e2e-client-secret
TESLA_REDIRECT_URI=http://127.0.0.1:18080/auth/callback
TESLA_AUDIENCE=https://fleet-api.prd.na.vn.cloud.tesla.com
TELEMETRY_HOSTNAME=fleet-telemetry
TELEMETRY_PORT=443
MQTT_TOPIC_BASE=telemetry
$VAPID
VAPID_SUBJECT=mailto:e2e@example.com
BRIDGE_TOKEN=$(openssl rand -hex 16)
HOME_RATE_PER_KWH=0.30
TIRE_TARGET_PSI=42
ENV

COMPOSE=(docker compose -p plaid-e2e --project-directory "$WORK/deploy" -f "$WORK/deploy/docker-compose.yml" -f "$WORK/test/e2e/compose.e2e.yml" --env-file "$WORK/.env")
cleanup() {
  for s in app fleet-telemetry mosquitto tesla-proxy fakes; do "${COMPOSE[@]}" logs --no-color "$s" > "$RESULTS/$s.log" 2>&1 || true; done
  if [ -z "${KEEP:-}" ]; then "${COMPOSE[@]}" --profile car down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$WORK"; else echo "stack left running; work dir $WORK"; fi
}
trap cleanup EXIT

"${COMPOSE[@]}" --profile car build
"${COMPOSE[@]}" up -d mosquitto fleet-telemetry tesla-proxy app fakes

E2E_COMPOSE="${COMPOSE[*]}" E2E_WORK=$WORK E2E_RESULTS=$RESULTS \
  node "$HERE/verify.mjs"
