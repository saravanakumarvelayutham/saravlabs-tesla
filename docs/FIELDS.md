# Telemetry fields

Generated from `server/signals.js` by `node scripts/fields-doc.js`. Do not edit by hand.

Source: Tesla's [Available Data](https://developer.tesla.com/docs/fleet-api/fleet-telemetry/available-data) page and
[vehicle_data.proto](https://github.com/teslamotors/fleet-telemetry/blob/main/protos/vehicle_data.proto), checked 2026-10-22.

- **Documented**: the field and its unit are on Tesla's page.
- **Unit not stated by Tesla**: the field is documented but the unit is this app's reading; the UI labels it as assumed.
- **Not in Tesla docs**: the field exists in the proto but Tesla's page does not list it. Shown only if the car sends it.

Interval is `interval_seconds`: the car sends a field at most once per interval, and only when it changed.

| Field | Interval | Unit | Status | Notes |
|---|---|---|---|---|
| `Soc` | 60 s | % | Documented | Usable state of charge, percent of total battery capacity. |
| `BatteryLevel` | 60 s | % | Documented | State of charge, percent of total battery capacity. |
| `EnergyRemaining` | 60 s | kWh | Documented | Nominal energy remaining in the pack, kWh. |
| `RatedRange` | 60 s | mi | Unit not stated by Tesla | Tesla gives no unit; maps to vehicle_data charge_state.battery_range. |
| `ChargeLimitSoc` | 1 s | % | Documented | Charge limit, percent. |
| `DetailedChargeState` | 1 s | — | Documented | Enum, firmware 2024.38+. |
| `ACChargingPower` | 10 s | kW | Unit not stated by Tesla | Tesla says "Total AC charger input power" without a unit. |
| `DCChargingPower` | 10 s | kW | Documented | Kilowatts added during a DC session. |
| `ACChargingEnergyIn` | 30 s | kWh | Documented | Energy from the charger in an AC session; ignore during DC. |
| `DCChargingEnergyIn` | 30 s | kWh | Documented | Energy added in a session, measured at the battery; valid for AC and DC. |
| `TimeToFullCharge` | 60 s | h | Documented | Hours until charging is complete (to ChargeLimitSoc). |
| `FastChargerType` | 1 s | — | Documented | Enum FastCharger. |
| `ChargePortDoorOpen` | 1 s | — | Documented | Boolean. |
| `BatteryHeaterOn` | 60 s | — | Documented | Boolean. |
| `BrickVoltageMax` | 600 s | V | Unit not stated by Tesla | Tesla gives no unit. |
| `BrickVoltageMin` | 600 s | V | Unit not stated by Tesla | Tesla gives no unit. |
| `ModuleTempMax` | 300 s | °C | Unit not stated by Tesla | Tesla says "maximum thermistor temperature" without a unit. |
| `ModuleTempMin` | 300 s | °C | Unit not stated by Tesla | Tesla gives no unit. |
| `NominalFullPackEnergyKwh` | 3600 s | kWh | Documented | Proto fields 260-269 need firmware 2026.32. Needs firmware 2026.32+. |
| `Gear` | 1 s | — | Documented | Enum ShiftState (ShiftStateP, ShiftStateD, ...). |
| `VehicleSpeed` | 1 s | mph | Documented | Speed in miles per hour. |
| `Odometer` | 60 s | mi | Documented | Miles driven. |
| `LongitudinalAcceleration` | 1 s | m/s² | Documented | Longitudinal acceleration, m/s^2. |
| `LateralAcceleration` | 1 s | m/s² | Documented | Lateral acceleration, m/s^2. |
| `PedalPosition` | 1 s | % | Unit not stated by Tesla | Tesla says "position of the accelerator pedal" without a unit. |
| `DiTorqueActualF` | 1 s | — | Unit not stated by Tesla | Torque; Tesla gives no unit. The app only shows each motor's share. |
| `DiTorqueActualREL` | 1 s | — | Unit not stated by Tesla | As above. |
| `DiTorqueActualRER` | 1 s | — | Unit not stated by Tesla | As above. |
| `DiStatorTempF` | 60 s | °C | Unit not stated by Tesla | Tesla gives no unit. |
| `DiStatorTempREL` | 60 s | °C | Unit not stated by Tesla | Tesla gives no unit. |
| `DiStatorTempRER` | 60 s | °C | Unit not stated by Tesla | Tesla gives no unit. |
| `DiInverterTF` | 60 s | °C | Unit not stated by Tesla | Tesla gives no unit. |
| `DiInverterTREL` | 60 s | °C | Unit not stated by Tesla | Tesla gives no unit. |
| `DiInverterTRER` | 60 s | °C | Unit not stated by Tesla | Tesla gives no unit. |
| `Location` | 10 s | — | Documented | {latitude, longitude}. |
| `LocatedAtHome` | 1 s | — | Documented | At the active driver profile's saved home. |
| `LocatedAtWork` | 1 s | — | Documented |  |
| `LocatedAtFavorite` | 1 s | — | Documented |  |
| `DestinationName` | 5 s | — | Documented | Invalid when no destination. |
| `MinutesToArrival` | 30 s | min | Documented |  |
| `MilesToArrival` | 30 s | mi | Documented |  |
| `RouteTrafficMinutesDelay` | 60 s | min | Documented |  |
| `ExpectedEnergyPercentAtTripArrival` | 60 s | % | Documented |  |
| `InsideTemp` | 60 s | °C | Documented | Cabin temperature in Celsius; Tesla recommends a minimum delta. minimum_delta 0.5. |
| `OutsideTemp` | 300 s | °C | Unit not stated by Tesla | Tesla gives no unit; maps to climate_state.outside_temp. |
| `HvacPower` | 1 s | — | Documented | Enum HvacPowerState. |
| `CabinOverheatProtectionMode` | 60 s | — | Documented | Enum CabinOverheatProtectionModeState. |
| `Locked` | 1 s | — | Documented |  |
| `DoorState` | 1 s | — | Documented | Object of six booleans (DriverFront, ... TrunkRear). |
| `FdWindow` | 1 s | — | Documented | Enum WindowState. |
| `FpWindow` | 1 s | — | Documented |  |
| `RdWindow` | 1 s | — | Documented |  |
| `RpWindow` | 1 s | — | Documented |  |
| `SentryMode` | 1 s | — | Documented | Enum SentryModeState. |
| `TpmsPressureFl` | 300 s | bar | Documented |  |
| `TpmsPressureFr` | 300 s | bar | Documented |  |
| `TpmsPressureRl` | 300 s | bar | Documented |  |
| `TpmsPressureRr` | 300 s | bar | Documented |  |
| `TpmsSoftWarnings` | 1 s | — | Documented | TireLocation flags. |
| `TpmsHardWarnings` | 1 s | — | Documented | TireLocation flags. |
| `VehicleName` | 3600 s | — | Documented |  |
| `Version` | 3600 s | — | Documented |  |
| `SoftwareUpdateVersion` | 60 s | — | Documented | Version of an available update. |
| `SoftwareUpdateAvailable` | 60 s | — | Documented | Needs firmware 2026.32+. |
| `LifetimeEnergyGainedRegen` | 600 s | kWh | Not in Tesla docs (proto only) |  |

## Not used, and why

- `LifetimeEnergyUsedDrive`: Tesla marks it "Semi-truck only". Trip energy comes from the change in `EnergyRemaining`.
- Tesla's `charging_history` endpoint: the response format isn't published, so the Setup page shows it raw and nothing is derived from it yet.

