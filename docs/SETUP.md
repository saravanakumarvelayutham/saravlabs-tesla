# Setup

Two ways to run it:

- **Sample mode** (no Tesla account): `npm install && npm run dev`, then open http://localhost:8080. All data is simulated and every screen shows a SAMPLE DATA badge.
- **Your car**: follow the checklist below. Steps 1–6 are one-time Tesla paperwork; after that it runs by itself.

The Docker stack in `deploy/` and the Pi bridge haven't been run against a real car yet. Expect to check logs on first start.

## What you need to provide

| # | Item | Where it comes from | Goes in |
|---|---|---|---|
| 1 | A domain with two hostnames, e.g. `plaid.example.com` (dashboard) and `telemetry.example.com` (car connects here) | Your DNS, pointing at the server | `PUBLIC_URL`, `APP_DOMAIN`, `TELEMETRY_HOSTNAME` |
| 2 | Tesla developer app: **client ID** and **client secret** | [developer.tesla.com](https://developer.tesla.com) → create app. Allowed origin `https://plaid.example.com`, redirect URI `https://plaid.example.com/auth/callback`. Choose "Authorization Code and Machine-to-Machine". Scopes: vehicle information, vehicle location, vehicle commands, vehicle charging management | `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET` |
| 3 | **Virtual key** (EC prime256v1 key pair) | Generate (below). The private key stays on the server | `deploy/config/proxy/fleet-key.pem` + `fleet-key-public.pem` |
| 4 | **Proxy TLS certificate** for tesla-http-proxy | Generate (below), self-signed is fine; only the app talks to it | `deploy/config/proxy/tls-key.pem`, `tls-cert.pem` |
| 5 | **Telemetry server certificate** for `telemetry.example.com`, plus its full CA chain | Any CA, e.g. Let's Encrypt via certbot | `deploy/config/telemetry/server-cert.pem`, `server-key.pem`, `ca.pem` |
| 6 | Your car's **VIN** | Car: Controls → Software | `VIN` |
| 7 | **VAPID keys** for notifications | `npm run vapid` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| 8 | **App passcode** and **session secret** | Make them up (`openssl rand -hex 32` for the secret) | `APP_PASSCODE`, `SESSION_SECRET` |
| 9 | **Bridge token** shared with the garage Pi | `openssl rand -hex 32` | `BRIDGE_TOKEN` (server and Pi) |
| 10 | Home electricity price, tire placard pressure | Your bill; driver door jamb | `HOME_RATE_PER_KWH`, `TIRE_TARGET_PSI` |

Car requirements from Tesla's docs: firmware 2024.26 or later for Fleet Telemetry (Model S/X with the Intel Atom computer need 2025.20+), and firmware 2026.32+ for `NominalFullPackEnergyKwh` and `SoftwareUpdateAvailable`. Until then, the battery screen uses an estimate and says so.

## Steps

```bash
cp .env.example .env            # fill in as you go
mkdir -p deploy/config/proxy deploy/config/telemetry
```

**Virtual key** (from Tesla's [virtual key guide](https://developer.tesla.com/docs/fleet-api/virtual-keys/developer-guide)):

```bash
openssl ecparam -name prime256v1 -genkey -noout -out deploy/config/proxy/fleet-key.pem
openssl ec -in deploy/config/proxy/fleet-key.pem -pubout -out deploy/config/proxy/fleet-key-public.pem
```

**Proxy TLS certificate.** This is Tesla's [example](https://github.com/teslamotors/vehicle-command#generating-a-server-tls-key-and-certificate) with the Docker hostname added, because the app checks it:

```bash
openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:secp384r1 -pkeyopt ec_param_enc:named_curve \
  -subj '/CN=tesla-proxy' -addext "subjectAltName=DNS:tesla-proxy,DNS:localhost" \
  -keyout deploy/config/proxy/tls-key.pem -out deploy/config/proxy/tls-cert.pem -sha256 -days 3650 \
  -addext "extendedKeyUsage = serverAuth" -addext "keyUsage = digitalSignature, keyCertSign, keyAgreement"
```

The tesla-http-proxy image runs as distroless `nonroot` (uid 65532), so give it the two private keys:

```bash
sudo chown 65532:65532 deploy/config/proxy/fleet-key.pem deploy/config/proxy/tls-key.pem
sudo chmod 600 deploy/config/proxy/fleet-key.pem deploy/config/proxy/tls-key.pem
```

**Telemetry certificate.** Copy your certificate, key and full chain into `deploy/config/telemetry/` as `server-cert.pem`, `server-key.pem` and `ca.pem`. The fleet-telemetry image runs as uid 65532, so `server-key.pem` must be readable by that uid. Tesla's [check_server_cert.sh](https://github.com/teslamotors/fleet-telemetry/blob/main/tools/check_server_cert.sh) validates the combination before you configure the car.

If your DNS is on Cloudflare, `deploy/telemetry-cert.sh` does all of this with Let's Encrypt (DNS challenge, so Caddy keeps port 80). Put a Cloudflare API token with Zone:DNS:Edit in `/root/.secrets/cloudflare.ini` as `dns_cloudflare_api_token = ...` (mode 600), then:

```bash
sudo deploy/telemetry-cert.sh telemetry.example.com
# renew daily; it only restarts fleet-telemetry when the certificate changed
echo "17 4 * * * root $PWD/deploy/telemetry-cert.sh telemetry.example.com" | sudo tee /etc/cron.d/telemetry-cert
```

Both hostnames must be "DNS only" (grey cloud) in Cloudflare: the car authenticates with a TLS client certificate, which fleet-telemetry has to receive directly.

**Start the stack** (opens 80/443 for the dashboard and 8443 for the car):

```bash
cd deploy && docker compose --env-file ../.env up -d --build
curl https://plaid.example.com/.well-known/appspecific/com.tesla.3p.public-key.pem   # must print your public key
```

The app only listens beyond localhost when `APP_PASSCODE` is set, so Caddy can't reach it without one.

**Register with Tesla, then pair the key:**

```bash
docker compose exec app node scripts/register-partner.js plaid.example.com
```

Then open `https://tesla.com/_ak/plaid.example.com` on your phone. The Tesla app asks you to approve the key in the car.

**Link your account and start streaming.** Open the dashboard, enter the passcode, go to Setup → Link Tesla account, then Setup → Send config to car (or `npm run telemetry-config -- --apply`). Wait until the config shows `synced: true`. If no data arrives, `npm run telemetry-config -- --status` shows Tesla's error list.

**Notifications.** On iPhone, open the dashboard in Safari, Share → Add to Home Screen, open it from the Home Screen, then Setup → Enable alerts. Safari only allows web push for Home Screen apps (iOS 16.4+).

**Garage Pi.** See [pi-bridge/README.md](../pi-bridge/README.md).

## Costs to know about

Fleet API is billed per request. The app never wakes the car by itself and reads data from Fleet Telemetry instead of polling `vehicle_data`. Commands go over Bluetooth when the Pi has reached the car in the last 2 minutes, and over Fleet API otherwise.
