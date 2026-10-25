# End-to-end test

Runs the production stack from `deploy/docker-compose.yml` with everything outside it replaced by a stand-in, and checks every hop:

```
fake car ──mTLS websocket──> tesla/fleet-telemetry ──MQTT──> mosquitto ──> app ──SSE──> PWA in Chromium
app ──HTTPS (pinned CA)──> tesla-http-proxy ──signs──> fake Fleet API
app ──OAuth code exchange──> fake fleet-auth
app ──web push (VAPID, aes128gcm)──> fake push service ──payload──> sw.js notification
```

```bash
test/e2e/run.sh          # needs Docker, Node 22, openssl, and Playwright with Chromium
KEEP=1 test/e2e/run.sh   # leave the stack up (app on 127.0.0.1:18080, passcode e2e-passcode)
```

Results land in `test/e2e/results/`: `report.md` (every check with what it saw), `report.json`, container logs and screenshots of the dashboard before and after the car connects. CI runs it in `.github/workflows/e2e.yml` and uploads that folder.

| Piece | What's real | What's a stand-in |
|---|---|---|
| `fake-car/` | Wire format: built with fleet-telemetry's own `messages/tesla` and `protos` packages, typed values as current firmware sends them | The car. Its client certificate comes from a test CA named "Tesla Issuing CA", trusted through `tls.ca_file` in a copy of the production telemetry config |
| `fakes/server.mjs` | | Tesla's token endpoint and Fleet API (reached through the real proxy via Docker network aliases), and a web push service that verifies the VAPID JWT and decrypts the RFC 8291 payload |
| `scenario.json` | | What the car sends: parked at home, a 10 mile drive, a Supercharger session, Sentry alarm, tire warning, update, an alert and an error record |
| everything else | `deploy/docker-compose.yml`, `deploy/fleet-telemetry/config.json`, `deploy/mosquitto/mosquitto.conf`, the app image, the certificate steps from `docs/SETUP.md` | |

Caddy isn't started: it needs a public domain to get a certificate.

## What only the real car can show

- Which value type the car picks for each field (the test sends doubles, floats, ints and enums as `vehicle_data.proto` allows), and which fields a Plaid actually populates.
- Tesla accepting the telemetry config JWS and the car connecting with it; the test checks the JWS header, claims and that `iss` is the virtual public key, but not the signature itself (Tesla's Schnorr scheme lives in vehicle-command's internal package).
- Delivery from Apple's or Google's push service to a phone.
- The "unlocked/window open away from home" alerts need 10 real minutes, and the daily slow-leak check needs days; both are covered by unit tests only.
