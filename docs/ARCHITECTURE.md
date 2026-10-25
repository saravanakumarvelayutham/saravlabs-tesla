# Architecture

```
            ┌──────────── mTLS WebSocket ────────────┐
  Model S ──┤                                        ▼
  Plaid     │                          tesla/fleet-telemetry ──MQTT──▶ Mosquitto ──▶ app (Node)
            │                                                                      │  SQLite
            └── Bluetooth ── garage Pi (tesla-control) ──HTTPS──────────────────────┤  web push
                                                                                   │  SSE
      Fleet API ◀── tesla-http-proxy (signs with virtual key) ◀─ telemetry config ─┤
                                                                                   ▼
                                                      PWA (phone Home Screen app + car browser)
```

## Data in

- **Fleet Telemetry.** The car streams the fields in `server/signals.js` to Tesla's `fleet-telemetry` server, which publishes them to MQTT as `<base>/<VIN>/v/<Field>` with JSON values (format from `datastore/mqtt/mqtt_payload.go`: enums as their proto names such as `ShiftStateP`, location as `{latitude, longitude}`). MQTT doesn't carry the car's timestamp, so the app stamps each value when it arrives. Connectivity and alerts arrive on their own topics.
- **Bluetooth.** The Pi posts `tesla-control` JSON. `server/ingest/ble.js` maps it onto the same field names with source `BLE`, converting nothing because both sides use bar and Celsius.
- **Sample mode.** `server/ingest/sample.js` writes 35 days of simulated history and then drives a live loop (park, drive with a launch, Supercharge) through the same `Store.put` path, with source `SAMPLE`.

Every value lands in `history` (append-only) and `latest`, and the UI shows where each reading came from (API, BLE, SAMPLE) and how old it is.

## Derived views (`server/derive/`)

| Module | What it works out | From |
|---|---|---|
| `trips.js` | Trips (Gear leaves P → returns to P), route, Wh/mi per segment | Gear, Odometer, EnergyRemaining, Location, VehicleSpeed |
| `regen.js` | Regen kWh and share per trip and week: the regen counter when the car sends it, else an estimate from pack voltage × current, checked against the EnergyRemaining drop | LifetimeEnergyGainedRegen, PackVoltage, PackCurrent, EnergyRemaining |
| `charging.js` | Sessions, DC curve, peak kW, kWh in, home cost | DetailedChargeState, FastChargerType, DC/ACChargingPower, …EnergyIn |
| `supercharger.js` | Supercharger cost per session and month, matched to sessions by start time (unverified format) | Fleet API charging_history |
| `health.js` | Pack capacity by month, cell balance, overnight drain (Sentry vs not), tire slow-leak detection | NominalFullPackEnergyKwh or EnergyRemaining÷BatteryLevel, BrickVoltage*, TPMS |
| `drive.js` | 0–60 estimate, tri-motor torque split, friction circle, peak heat | VehicleSpeed, Longitudinal/LateralAcceleration, DiTorqueActual*, DiStatorTemp* |
| `alerts.js` | Push alerts: Sentry alarm, TPMS hard warning, update ready, unlocked/window open away from home, charge complete, slow leak | the above |
| `vehicle-log.js` | Release notes and recent alerts parsed from cached Fleet API responses (format undocumented, so parsing is tolerant and the raw response stays visible); alerts streamed by Fleet Telemetry, kept with start/end times | `release_notes`, `recent_alerts`, MQTT `alerts/<name>/current` |

Thresholds that are this app's choice (not Tesla's) are labeled as such in the UI.

## No car commands

The app is for analytics and recommendations, so it sends no commands to the car (no lock, climate, charging control or wake) and has no command endpoint. The virtual key is still needed because Tesla requires `fleet_telemetry_config` to be signed with it; `tesla-http-proxy` does that signing. The Pi only reads state.

## Front end

No build step: `web/` is static ES modules. `core.js` holds state and the API client, `app.js` routes and opens the SSE stream, each screen is a view function returning HTML. Width ≥ 1000 px (or `?view=car`) shows the car-browser layout, which switches to a glance view while the car isn't in Park. The service worker caches the shell and shows push notifications.

The car on the Car screen is a 3D Model S drawn with three.js (MIT, vendored in `web/vendor/three/` with its license, so nothing loads from a CDN). The body isn't a downloaded model: `web/js/car3d.js` builds it in code as a loft of cross-sections sized to Tesla's published Model S dimensions, so there's no third-party asset license and Tesla's own 3D files aren't used. Doors, frunk, liftback and the charge port flap are cut out of that surface and open when `DoorState` and `ChargePortDoorOpen` say so; an open window drops its glass; the port glows green while charging and blue when plugged in. Telemetry has no paint colour, so it's a Setup choice. three.js loads only when the car is on screen, frames are drawn only while something moves, and a browser without WebGL gets the flat top view instead. Setup → Display shows which WebGL renderer the browser reported.

Trip routes are drawn over OpenStreetMap raster tiles (`web/js/map.js`), recolored to the dashboard palette by an SVG filter. No key or account is needed; the [OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/) asks for visible attribution (drawn on the map), the browser's normal Referer and User-Agent, no prefetching and no offline storage. Each tile is fetched once per page session and reused from memory, because views re-render on every live signal. Setup → Display → *Map tiles behind trip routes* turns them off, and then no request goes to openstreetmap.org.

## Security

- `APP_PASSCODE` login with an HMAC-signed cookie and a login rate limit. Without a passcode the server only listens on localhost.
- The bridge authenticates with `BRIDGE_TOKEN` and can only post state readings.
- The virtual key stays inside the proxy container; the Pi uses its own Bluetooth key.
- Tesla refresh tokens are single use, so the app saves the new one each time it refreshes.
