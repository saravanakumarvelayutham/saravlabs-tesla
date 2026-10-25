# Plaid dashboard

A dashboard for one Tesla Model S Plaid. It's a single web app that installs on the phone's Home Screen and also runs full screen in the car's browser.

- **Car**: an interactive 3D Model S that shows open doors, frunk, trunk, windows and the charge port as the car reports them, with tire pressures, range and cabin temperature
- **Insights**: a personalized range estimate to a 10% reserve, energy use by trip length, regen recovery, overnight drain expressed as driving-energy equivalents, observed DC charging taper, and cold tire-pressure trends. Each panel shows its evidence and sample limits; simulated data is labeled. Range requires five recent measured drives and fresh, closely timed battery readings.
- **Charge**: current session, DC charging curve, monthly kWh, home and Supercharger cost, cost per mile
- **Trips**: every drive with route trace and Wh/mi along the way
- **Health**: pack capacity over time, cell balance, overnight drain with and without Sentry, slow-leak detection per tire
- **Drive**: 0–60 estimate from your launches, tri-motor torque split, friction circle, motor heat
- **Alerts** to your phone: Sentry alarm, tire warning, update ready, car left unlocked or window open away from home, charge complete

Explore six connected chapters: **Vehicle**, **Energy**, **Journeys**, **Condition**, **Dynamics**, and **Insights**. The same interactive car changes camera, lighting, and annotations with each chapter; click a tire or charge-port annotation to inspect its data. The Vehicle chapter combines a weekly journal with observations, software notes, and the signal stream. Open **Insights** (`#/insights`) for the full evidence-backed analysis.

Data comes from Tesla Fleet Telemetry, plus Bluetooth through a Raspberry Pi in the garage. Any reading can show where it came from and how old it is (Setup → Display → data-source chips).

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
