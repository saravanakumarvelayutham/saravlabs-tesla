// Maps `tesla-control -ble` JSON (protojson of vehicle.proto / vcsec.proto, lowerCamelCase keys)
// posted by the garage Pi onto the same field names Fleet Telemetry uses, with source "BLE".
//
// Field names come from teslamotors/vehicle-command pkg/protocol/protobuf/vehicle.proto
// (ChargeState, ClimateState, ClosuresState, TirePressureState) and vcsec.proto (VehicleStatus).
// Tire pressures are in bar in both protos, so no conversion is needed here.

const oneofName = (v) => (v && typeof v === 'object' ? Object.keys(v)[0] : null);
const windowState = (open) => (open === true ? 'WindowStateOpened' : open === false ? 'WindowStateClosed' : undefined);

export function mapBleState(kind, data) {
  const out = {};
  const set = (k, v) => { if (v !== undefined && v !== null) out[k] = v; };
  if (kind === 'body-controller-state') {
    const lock = data.vehicleLockState;
    if (lock) set('Locked', lock === 'VEHICLELOCKSTATE_LOCKED' || lock === 'VEHICLELOCKSTATE_INTERNAL_LOCKED');
    return out;
  }
  const cs = data.chargeState;
  if (cs) {
    set('Soc', cs.usableBatteryLevel);
    set('BatteryLevel', cs.batteryLevel);
    set('ChargeLimitSoc', cs.chargeLimitSoc);
    set('RatedRange', cs.batteryRange);
  }
  const cl = data.climateState;
  if (cl) {
    set('InsideTemp', cl.insideTempCelsius);
    set('OutsideTemp', cl.outsideTempCelsius);
  }
  const tp = data.tirePressureState;
  if (tp) {
    set('TpmsPressureFl', tp.tpmsPressureFl);
    set('TpmsPressureFr', tp.tpmsPressureFr);
    set('TpmsPressureRl', tp.tpmsPressureRl);
    set('TpmsPressureRr', tp.tpmsPressureRr);
    // The car's recommended cold pressure (bar); not available as a telemetry field.
    set('TpmsRcpFront', tp.tpmsRcpFrontValue);
    set('TpmsRcpRear', tp.tpmsRcpRearValue);
    // google.protobuf.Timestamp, which protojson writes as an RFC 3339 string.
    set('TpmsLastSeenPressureTimeFl', tp.tpmsLastSeenPressureTimeFl);
    set('TpmsLastSeenPressureTimeFr', tp.tpmsLastSeenPressureTimeFr);
    set('TpmsLastSeenPressureTimeRl', tp.tpmsLastSeenPressureTimeRl);
    set('TpmsLastSeenPressureTimeRr', tp.tpmsLastSeenPressureTimeRr);
  }
  const cz = data.closuresState;
  if (cz) {
    set('Locked', cz.locked);
    set('FdWindow', windowState(cz.windowOpenDriverFront));
    set('FpWindow', windowState(cz.windowOpenPassengerFront));
    set('RdWindow', windowState(cz.windowOpenDriverRear));
    set('RpWindow', windowState(cz.windowOpenPassengerRear));
    const sentry = oneofName(cz.sentryModeState);
    if (sentry) set('SentryMode', `SentryModeState${sentry}`);
  }
  return out;
}

export function ingestBle(store, { kind, data, ts }) {
  const fields = mapBleState(kind, data || {});
  const at = Number.isFinite(ts) ? ts : Date.now();
  for (const [k, v] of Object.entries(fields)) store.put(k, v, at, 'BLE');
  return fields;
}
