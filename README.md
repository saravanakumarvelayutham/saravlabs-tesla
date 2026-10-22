# Plaid dashboard

A dashboard for one Tesla Model S Plaid. It's a single web app that installs on the phone's Home Screen and also runs full screen in the car's browser.

- **Car**: live state, car wireframe with tire pressures, lock/climate/charge limit/Sentry/update buttons
- **Charge**: current session, DC charging curve, monthly kWh and home charging cost
- **Trips**: every drive with route trace and Wh/mi along the way
- **Health**: pack capacity over time, cell balance, overnight drain with and without Sentry, slow-leak detection per tire
- **Drive**: 0–60 estimate from your launches, tri-motor torque split, friction circle, motor heat
- **Alerts** to your phone: Sentry alarm, tire warning, update ready, car left unlocked or window open away from home, charge complete

Data comes from Tesla Fleet Telemetry, plus Bluetooth through a Raspberry Pi in the garage. Every reading shows where it came from and how old it is.

## Try it

```bash
npm install
npm run dev        # sample mode on http://localhost:8080
npm test
```

Open `http://localhost:8080/?view=car` for the car-browser layout.

## Run it for your car

[docs/SETUP.md](docs/SETUP.md) lists every credential and step. Also see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/FIELDS.md](docs/FIELDS.md) for each telemetry field and how sure we are of its unit, and [pi-bridge/README.md](pi-bridge/README.md).

Requires Node 22.13+ (uses the built-in `node:sqlite`).
