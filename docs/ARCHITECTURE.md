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

The car on the Car screen loads a local, meshopt-compressed GLB through vendored Three.js r180. The artist model, "Tesla Model S Plaid 2021" by 3D Hawk, is licensed CC BY 4.0; provenance and modifications are in `web/models/LICENSE.txt`, with attribution in the viewer and Setup. The optimized public mirror preserves the body, lights, interior and wheel geometry. It is artist-authored, not manufacturer CAD or a verified exact 2023 replica. The default finish is Ultra Red; Setup still supports paint selection. Door, window, frunk, trunk and charge-port telemetry appears as labels: the mesh has no verified articulation rig, so panels remain closed. The GLB, loader and decoder are cached with the offline shell. Three.js loads only when the car is on screen, frames render on demand, and a browser without WebGL or with an asset-loading failure gets the flat schematic fallback. Setup shows the reported WebGL renderer.

Trip routes are drawn over OpenStreetMap raster tiles (`web/js/map.js`), recolored to the dashboard palette by an SVG filter. No key or account is needed; the [OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/) asks for visible attribution (drawn on the map), the browser's normal Referer and User-Agent, no prefetching and no offline storage. Each tile is fetched once per page session and reused from memory, because views re-render on every live signal. Setup → Display → *Map tiles behind trip routes* turns them off, and then no request goes to openstreetmap.org.

`experience.js` composes the shared shell for six chapters (Vehicle, Energy, Journeys, Condition, Dynamics, Insights), while existing views retain ownership of their data and calculations. `experience.css` owns the chapter layout, typography, instruments and scene controls; `app.css` retains the shared UI primitives and analytics charts. Secondary screens (Setup, Software, Alerts) use the same shell. A render generation guards against an older asynchronous route overwriting a newer one.

The same on-demand Three.js renderer moves between chapter slots. Mode changes transition camera, lighting and annotations; telemetry updates preserve the chosen view. Energy paths appear only during a reported active charge, motor shares require all three finite signals and use explicitly schematic anchors, and TPMS warnings remain visible when routine labels are hidden. Dragging or arrow keys orbit the car; Studio/Profile/Rear/Top buttons choose a view and Home restores Studio. Reduced-motion users get immediate camera changes without inertia. Live DOM replacement preserves camera controls, keyboard focus and expanded insight evidence. Source chips remain beside the scene instruments when enabled. Phone navigation uses a bottom dock with a compact freshness indicator; wide screens retain the automatic driving glance view without scene controls.

## Security

- `APP_PASSCODE` login with an HMAC-signed cookie and a login rate limit. Without a passcode the server only listens on localhost.
- The bridge authenticates with `BRIDGE_TOKEN` and can only post state readings.
- The virtual key stays inside the proxy container; the Pi uses its own Bluetooth key.
- Tesla refresh tokens are single use, so the app saves the new one each time it refreshes.
