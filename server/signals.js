// The Fleet Telemetry fields this app streams, with the units Tesla documents.
//
// Sources (checked 2026-10-22):
//   Field list and descriptions: https://developer.tesla.com/docs/fleet-api/fleet-telemetry/available-data
//   Field enum and value types:  https://github.com/teslamotors/fleet-telemetry/blob/main/protos/vehicle_data.proto
//
// `unit` is what Tesla's Available Data page states. Where Tesla does not state a unit,
// `unitNote` says so, and the UI treats that value as unverified until checked on the car.
// `interval` is interval_seconds in the fleet_telemetry_config: the car sends a field only
// when it changed and at most once per interval.

const BAR_TO_PSI = 14.503773773;

export const SIGNALS = {
  // Charging and battery
  Soc: { interval: 60, unit: '%', doc: 'Usable state of charge, percent of total battery capacity.' },
  BatteryLevel: { interval: 60, unit: '%', doc: 'State of charge, percent of total battery capacity.' },
  EnergyRemaining: { interval: 60, unit: 'kWh', doc: 'Nominal energy remaining in the pack, kWh.' },
  RatedRange: { interval: 60, unit: 'mi', unitNote: 'Tesla gives no unit; maps to vehicle_data charge_state.battery_range.' },
  ChargeLimitSoc: { interval: 1, unit: '%', doc: 'Charge limit, percent.' },
  DetailedChargeState: { interval: 1, doc: 'Enum, firmware 2024.38+.' },
  ACChargingPower: { interval: 10, unit: 'kW', unitNote: 'Tesla says "Total AC charger input power" without a unit.' },
  DCChargingPower: { interval: 10, unit: 'kW', doc: 'Kilowatts added during a DC session.' },
  ACChargingEnergyIn: { interval: 30, unit: 'kWh', doc: 'Energy from the charger in an AC session; ignore during DC.' },
  DCChargingEnergyIn: { interval: 30, unit: 'kWh', doc: 'Energy added in a session, measured at the battery; valid for AC and DC.' },
  ChargerVoltage: { interval: 10, minimumDelta: 1, unit: 'V', doc: "RMS of the AC charger's input voltage. Changes often even when not charging, so Tesla recommends a minimum delta. AC only." },
  TimeToFullCharge: { interval: 60, unit: 'h', doc: 'Hours until charging is complete (to ChargeLimitSoc).' },
  FastChargerType: { interval: 1, doc: 'Enum FastCharger.' },
  ChargePortDoorOpen: { interval: 1, doc: 'Boolean.' },
  BatteryHeaterOn: { interval: 60, doc: 'Boolean.' },
  BrickVoltageMax: { interval: 600, unit: 'V', unitNote: 'Tesla gives no unit.' },
  BrickVoltageMin: { interval: 600, unit: 'V', unitNote: 'Tesla gives no unit.' },
  ModuleTempMax: { interval: 300, unit: '°C', unitNote: 'Tesla says "maximum thermistor temperature" without a unit.' },
  ModuleTempMin: { interval: 300, unit: '°C', unitNote: 'Tesla gives no unit.' },
  // Battery power while driving, for the regen estimate when LifetimeEnergyGainedRegen is absent.
  // Tesla documents both fields but not their units or which way the current is signed.
  PackVoltage: { interval: 5, minimumDelta: 1, unit: 'V', unitNote: 'Tesla says "voltage measured on the battery side of the HV contactors" without a unit.' },
  PackCurrent: { interval: 1, minimumDelta: 2, unit: 'A', unitNote: 'Tesla says "current measured at the HV contactors" without a unit or sign convention.' },
  NominalFullPackEnergyKwh: { interval: 3600, unit: 'kWh', minFirmware: '2026.32', unverified: true, doc: 'Proto field 263; fields 260-269 need firmware 2026.32. Not on the Available Data page.' },

  // Driving
  Gear: { interval: 1, doc: 'Enum ShiftState (ShiftStateP, ShiftStateD, ...).' },
  VehicleSpeed: { interval: 1, unit: 'mph', doc: 'Speed in miles per hour.' },
  Odometer: { interval: 60, unit: 'mi', doc: 'Miles driven.' },
  LongitudinalAcceleration: { interval: 1, unit: 'm/s²', doc: 'Longitudinal acceleration, m/s^2.' },
  LateralAcceleration: { interval: 1, unit: 'm/s²', doc: 'Lateral acceleration, m/s^2.' },
  BrakePedalPos: { interval: 1, numeric: true, unitNote: 'Tesla: "master cylinder pressure measured in the ESP", no unit. Shown as a relative value.' },
  // Proto field 264 (firmware 2026.32+), not on Tesla's Available Data page.
  GradeEstimatePercent: { interval: 5, unit: '%', minFirmware: '2026.32', unverified: true },
  PedalPosition: { interval: 1, unit: '%', unitNote: 'Tesla says "position of the accelerator pedal" without a unit.' },

  // Powertrain (Plaid: front, rear-left, rear-right drive units)
  DiTorqueActualF: { interval: 1, unitNote: 'Torque; Tesla gives no unit. The app only shows each motor\'s share.' },
  DiTorqueActualREL: { interval: 1, unitNote: 'As above.' },
  DiTorqueActualRER: { interval: 1, unitNote: 'As above.' },
  DiStatorTempF: { interval: 60, unit: '°C', unitNote: 'Tesla gives no unit.' },
  DiStatorTempREL: { interval: 60, unit: '°C', unitNote: 'Tesla gives no unit.' },
  DiStatorTempRER: { interval: 60, unit: '°C', unitNote: 'Tesla gives no unit.' },
  DiInverterTF: { interval: 60, unit: '°C', unitNote: 'Tesla gives no unit.' },
  DiInverterTREL: { interval: 60, unit: '°C', unitNote: 'Tesla gives no unit.' },
  DiInverterTRER: { interval: 60, unit: '°C', unitNote: 'Tesla gives no unit.' },

  // Location and navigation (need the vehicle_location scope)
  Location: { interval: 10, location: true, doc: '{latitude, longitude}.' },
  LocatedAtHome: { interval: 1, doc: 'At the active driver profile\'s saved home.' },
  LocatedAtWork: { interval: 1 },
  LocatedAtFavorite: { interval: 1 },
  DestinationName: { interval: 5, location: true, doc: 'Invalid when no destination.' },
  MinutesToArrival: { interval: 30, unit: 'min' },
  MilesToArrival: { interval: 30, unit: 'mi' },
  RouteTrafficMinutesDelay: { interval: 60, unit: 'min' },
  ExpectedEnergyPercentAtTripArrival: { interval: 60, unit: '%' },

  // Climate
  InsideTemp: { interval: 60, minimumDelta: 0.5, unit: '°C', doc: 'Cabin temperature in Celsius; Tesla recommends a minimum delta.' },
  OutsideTemp: { interval: 300, unit: '°C', unitNote: 'Tesla gives no unit; maps to climate_state.outside_temp.' },
  HvacPower: { interval: 1, doc: 'Enum HvacPowerState.' },
  CabinOverheatProtectionMode: { interval: 60, doc: 'Enum CabinOverheatProtectionModeState.' },

  // Security and body
  Locked: { interval: 1 },
  DoorState: { interval: 1, doc: 'Object of six booleans (DriverFront, ... TrunkRear).' },
  FdWindow: { interval: 1, doc: 'Enum WindowState.' },
  FpWindow: { interval: 1 },
  RdWindow: { interval: 1 },
  RpWindow: { interval: 1 },
  SentryMode: { interval: 1, doc: 'Enum SentryModeState.' },

  // Tires (Tesla documents these in bar; converted to psi for display)
  TpmsPressureFl: { interval: 300, unit: 'bar' },
  TpmsPressureFr: { interval: 300, unit: 'bar' },
  TpmsPressureRl: { interval: 300, unit: 'bar' },
  TpmsPressureRr: { interval: 300, unit: 'bar' },
  // Tesla: "Timestamp fields report incorrectly. Treating the reported value as Pacific Time will
  // yield the date and time in the vehicle's timezone." The wire format over MQTT isn't documented.
  TpmsLastSeenPressureTimeFl: { interval: 3600, unitNote: 'Timestamp; see the Pacific Time note.' },
  TpmsLastSeenPressureTimeFr: { interval: 3600, unitNote: 'As above.' },
  TpmsLastSeenPressureTimeRl: { interval: 3600, unitNote: 'As above.' },
  TpmsLastSeenPressureTimeRr: { interval: 3600, unitNote: 'As above.' },
  // Recommended cold pressure (bar). Only over Bluetooth (TirePressureState.tpms_rcp_*_value in
  // vehicle.proto); not a telemetry field, so it is left out of the telemetry config.
  TpmsRcpFront: { interval: 0, unit: 'bar', bleOnly: true },
  TpmsRcpRear: { interval: 0, unit: 'bar', bleOnly: true },
  TpmsSoftWarnings: { interval: 1, doc: 'TireLocation flags.' },
  TpmsHardWarnings: { interval: 1, doc: 'TireLocation flags.' },

  // Software and identity
  VehicleName: { interval: 3600 },
  Version: { interval: 3600 },
  SoftwareUpdateVersion: { interval: 60, doc: 'Version of an available update.' },
  // Tesla: download percent "will go from 0-100% multiple times" for one update, so 100 doesn't mean ready.
  SoftwareUpdateDownloadPercentComplete: { interval: 60, unit: '%', doc: 'Percent of the update downloaded.' },
  SoftwareUpdateInstallationPercentComplete: { interval: 60, unit: '%', doc: 'Percent of the update installed.' },
  SoftwareUpdateExpectedDurationMinutes: { interval: 3600, unit: 'min', doc: 'Estimated install time.' },
  // Proto field 266, not on the Available Data page. On a 2026.38 Plaid it was false while the update
  // downloaded and turned true when the Tesla app offered Install.
  SoftwareUpdateAvailable: { interval: 60, minFirmware: '2026.32', doc: 'True once the update is ready to install.' },
  // In vehicle_data.proto (field 134, not marked Semi-only) but not listed on Tesla's
  // Available Data page. Streamed so we can see whether a Plaid populates it. 60 s like
  // Odometer, so the reading after Park lands inside a trip's finalize window.
  LifetimeEnergyGainedRegen: { interval: 60, unit: 'kWh', unverified: true },
};

export const barToPsi = (bar) => (bar == null ? null : bar * BAR_TO_PSI);

// Body for POST /api/1/vehicles/fleet_telemetry_config through tesla-http-proxy.
// Config keys (hostname, port, ca, fields, alert_types) follow the fleet-telemetry README's
// vehicle configuration section; the proxy adds iss/aud and signs it.
export function buildTelemetryConfig({ vin, hostname, port, ca, expDays }) {
  const fields = {};
  for (const [name, s] of Object.entries(SIGNALS)) {
    if (s.bleOnly) continue;
    fields[name] = { interval_seconds: s.interval };
    if (s.minimumDelta) fields[name].minimum_delta = s.minimumDelta;
  }
  const cfg = { hostname, port, ca, fields, alert_types: ['service'] };
  if (expDays) cfg.exp = Math.floor(Date.now() / 1000) + expDays * 86400;
  return { vins: [vin], config: cfg };
}
