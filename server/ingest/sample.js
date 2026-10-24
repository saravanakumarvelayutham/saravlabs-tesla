// Sample mode: simulated signals pushed through the same Store as real Fleet Telemetry data,
// tagged with source "SAMPLE" so the UI labels them. Nothing here is real car data.
//
// backfill() writes ~5 weeks of history (commutes, home and Supercharger sessions, a slow leak in
// the rear-left tire, Sentry nights) so every screen has something to show. live() then runs a
// short repeating loop (park, drive with a launch, park, Supercharge) in real time.

const SRC = 'SAMPLE';
const CAPACITY_KWH = 95; // simulated pack, not a Tesla figure
const HOME = { lat: 37.3947, lon: -122.1503 };
const WORK = { lat: 37.4419, lon: -122.143 };

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export class Sample {
  constructor(store) {
    this.store = store;
    this.rand = rng(42);
    this.soc = 72;
    this.odo = 18234.2;
    this.capacity = CAPACITY_KWH + 2.2;
    this.regen = 1843.6; // lifetime regen kWh (simulated)
  }

  put(field, value, ts) {
    this.store.put(field, value, ts, SRC);
  }

  energy() {
    return (this.soc / 100) * this.capacity;
  }

  putBattery(ts) {
    this.put('Soc', round(this.soc, 1), ts);
    this.put('BatteryLevel', round(this.soc + 0.6, 1), ts);
    this.put('EnergyRemaining', round(this.energy(), 2), ts);
    this.put('RatedRange', round(this.soc * 3.86, 1), ts);
  }

  setPlace(ts, place) {
    this.put('LocatedAtHome', place === 'home', ts);
    this.put('LocatedAtWork', place === 'work', ts);
    this.put('LocatedAtFavorite', false, ts);
  }

  static(ts) {
    this.put('VehicleName', 'Plaid', ts);
    this.put('Version', '2026.32.4', ts);
    this.put('ChargeLimitSoc', 80, ts);
    this.put('Gear', 'ShiftStateP', ts);
    this.put('Locked', true, ts);
    this.put('DoorState', { DriverFront: false, PassengerFront: false, DriverRear: false, PassengerRear: false, TrunkFront: false, TrunkRear: false }, ts);
    for (const w of ['FdWindow', 'FpWindow', 'RdWindow', 'RpWindow']) this.put(w, 'WindowStateClosed', ts);
    this.put('TpmsSoftWarnings', {}, ts);
    this.put('TpmsHardWarnings', {}, ts);
    this.put('HvacPower', 'HvacPowerStateOff', ts);
    this.put('CabinOverheatProtectionMode', 'CabinOverheatProtectionModeStateOn', ts);
    this.put('DetailedChargeState', 'DetailedChargeStateDisconnected', ts);
    this.put('BatteryHeaterOn', false, ts);
    // Over Bluetooth in real life (tesla-control state tire-pressure); 2.9 bar is about 42 psi.
    this.put('TpmsRcpFront', 2.9, ts);
    this.put('TpmsRcpRear', 2.9, ts);
  }

  // Overnight / workday parking: hourly Soc, drain faster with Sentry on.
  park(from, to, { sentry, tires, place }) {
    this.put('SentryMode', sentry ? 'SentryModeStateArmed' : 'SentryModeStateOff', from);
    const perHour = sentry ? 0.24 : 0.075;
    for (let t = from + 3600_000; t <= to; t += 3600_000) {
      this.soc -= perHour * (0.85 + this.rand() * 0.3);
      this.putBattery(t);
      this.put('InsideTemp', round(16 + this.rand() * 3, 1), t);
      if (tires && t - from >= 3.5 * 3600_000 && !this._tireDone) {
        this._tireDone = true;
        tires(t);
      }
    }
    this._tireDone = false;
  }

  drive(start, miles, { to, outsideC, launch, place }) {
    let ts = start;
    this.put('OutsideTemp', outsideC, ts);
    this.put('SentryMode', 'SentryModeStateOff', ts);
    this.put('Gear', 'ShiftStateD', ts);
    this.setPlace(ts, null);
    const whPerMile = 285 + Math.max(0, 20 - outsideC) * 2.4 + this.rand() * 25;
    const from = place === 'work' ? WORK : HOME;
    const dest = to === 'work' ? WORK : HOME;
    let done = 0;
    let speed = 0;
    let step = 0;
    const cruise = 38 + this.rand() * 20;
    while (done < miles) {
      ts += 10_000;
      step++;
      if (launch && step === 6) {
        // A launch: dense 0.5 s samples so the 0-60 estimate has something to work with.
        this.put('VehicleSpeed', 0, ts);
        const profile = [0, 8, 19, 30, 41, 51, 60.5, 68];
        for (let i = 1; i < profile.length; i++) {
          const t = ts + i * 400;
          this.put('PedalPosition', 100, t);
          this.put('LongitudinalAcceleration', round(11 - i * 0.6, 2), t);
          this.put('DiTorqueActualF', round(2100 - i * 40, 0), t);
          this.put('DiTorqueActualREL', round(2450 - i * 30, 0), t);
          this.put('DiTorqueActualRER', round(2380 - i * 30, 0), t);
          this.put('VehicleSpeed', profile[i], t);
        }
        ts += 4000;
        speed = 68;
      } else {
        speed = Math.max(0, Math.min(cruise + 15, speed + (cruise - speed) * 0.3 + (this.rand() - 0.5) * 12));
        this.put('VehicleSpeed', round(speed, 1), ts);
        this.put('PedalPosition', round(Math.max(0, (speed - 10) / 2 + this.rand() * 8), 1), ts);
        const accel = round((this.rand() - 0.5) * 3.2, 2);
        this.put('LongitudinalAcceleration', accel, ts);
        this.put('LateralAcceleration', round((this.rand() - 0.5) * 5.4, 2), ts);
        // Hard slowing uses the friction brakes; gentle slowing is mostly regen.
        this.put('BrakePedalPos', accel < -1.2 ? round(-accel * 9 + this.rand() * 4, 1) : 0, ts);
        if (accel < 0) this.regen += (-accel * speed) / 3600 * 0.9;
      }
      const d = (speed * 10) / 3600;
      done += d;
      this.odo += d;
      this.soc -= (d * whPerMile) / 1000 / this.capacity * 100;
      const f = Math.min(1, done / miles);
      const wobble = Math.sin(f * Math.PI * 3) * 0.004;
      this.put('Location', { latitude: from.lat + (dest.lat - from.lat) * f + wobble, longitude: from.lon + (dest.lon - from.lon) * f - wobble }, ts);
      if (step % 6 === 0) {
        this.put('LifetimeEnergyGainedRegen', round(this.regen, 2), ts);
        this.put('Odometer', round(this.odo, 1), ts);
        this.putBattery(ts);
        this.put('DiStatorTempF', round(55 + this.rand() * 15, 0), ts);
        this.put('DiStatorTempREL', round(62 + this.rand() * 25, 0), ts);
        this.put('DiStatorTempRER', round(60 + this.rand() * 24, 0), ts);
        this.put('DiInverterTRER', round(45 + this.rand() * 12, 0), ts);
        this.put('ModuleTempMax', round(28 + this.rand() * 6, 0), ts);
        this.put('ModuleTempMin', round(24 + this.rand() * 3, 0), ts);
      }
    }
    ts += 10_000;
    this.put('VehicleSpeed', 0, ts);
    this.put('Gear', 'ShiftStateP', ts);
    this.put('LifetimeEnergyGainedRegen', round(this.regen, 2), ts);
    this.setPlace(ts, to);
    this.put('Odometer', round(this.odo, 1), ts + 20_000);
    this.putBattery(ts + 20_000);
    return ts + 20_000;
  }

  charge(start, { dc, toSoc }) {
    let ts = start;
    const fc = dc ? 'FastChargerSupercharger' : 'FastChargerUnknown';
    this.put('FastChargerType', fc, ts);
    this.put('ChargePortDoorOpen', true, ts);
    this.put('DetailedChargeState', 'DetailedChargeStateCharging', ts);
    let addedBattery = 0;
    let addedWall = 0;
    const stepMs = dc ? 60_000 : 15 * 60_000;
    while (this.soc < toSoc) {
      ts += stepMs;
      const kw = dc ? Math.max(40, Math.min(250, 250 - Math.max(0, this.soc - 20) * 3.6)) * (0.95 + this.rand() * 0.05) : 11.5;
      const kwh = (kw * stepMs) / 3600_000;
      addedBattery += kwh * (dc ? 1 : 0.92);
      addedWall += kwh;
      this.soc = Math.min(toSoc, this.soc + (kwh * (dc ? 1 : 0.92)) / this.capacity * 100);
      this.put(dc ? 'DCChargingPower' : 'ACChargingPower', round(kw, 1), ts);
      // ChargerVoltage is the AC charger's input voltage (Tesla's docs), so only AC sessions have it.
      if (!dc) this.put('ChargerVoltage', round(238 + this.rand() * 4, 0), ts);
      this.put('DCChargingEnergyIn', round(addedBattery, 2), ts);
      if (!dc) this.put('ACChargingEnergyIn', round(addedWall, 2), ts);
      this.put('TimeToFullCharge', round(Math.max(0, (toSoc - this.soc) / (dc ? 90 : 11)), 2), ts);
      this.putBattery(ts);
    }
    ts += 60_000;
    this.put('DetailedChargeState', 'DetailedChargeStateComplete', ts);
    this.put(dc ? 'DCChargingPower' : 'ACChargingPower', 0, ts);
    ts += 5 * 60_000;
    this.put('DetailedChargeState', 'DetailedChargeStateDisconnected', ts);
    this.put('ChargePortDoorOpen', false, ts);
    return ts;
  }

  tires(dayIndex) {
    return (ts) => {
      const n = () => (this.rand() - 0.5) * 0.02;
      this.put('TpmsPressureFl', round(2.896 + n(), 3), ts);
      this.put('TpmsPressureFr', round(2.896 + n(), 3), ts);
      this.put('TpmsPressureRl', round(2.896 - Math.max(0, dayIndex - 8) * 0.0075 + n(), 3), ts);
      this.put('TpmsPressureRr', round(2.83 + n(), 3), ts);
      // The real wire format of these timestamps isn't documented; the sample sends epoch seconds.
      for (const w of ['Fl', 'Fr', 'Rl', 'Rr']) this.put(`TpmsLastSeenPressureTime${w}`, Math.floor(ts / 1000), ts);
    };
  }

  backfill(days = 35, now = Date.now()) {
    const day0 = new Date(now);
    day0.setHours(0, 0, 0, 0);
    let cursor = day0.getTime() - days * 86400_000;
    this.static(cursor - 1000);
    this.put('BrickVoltageMax', 3.883, cursor);
    this.put('BrickVoltageMin', 3.871, cursor);
    this.setPlace(cursor, 'home');
    this.putBattery(cursor);
    for (let i = 0; i < days; i++) {
      const midnight = day0.getTime() - (days - i) * 86400_000;
      const outside = Math.round(12 + 10 * Math.sin(i / 9) + this.rand() * 3);
      this.capacity -= 0.006;
      const sentry = i % 3 === 0;
      this.park(cursor, midnight + 7.75 * 3600_000, { sentry, tires: this.tires(i), place: 'home' });
      let t = this.drive(midnight + 7.75 * 3600_000, 17 + this.rand() * 3, { to: 'work', outsideC: outside, place: 'home' });
      this.park(t, midnight + 17.5 * 3600_000, { sentry: false });
      const weekend = i % 7 === 5;
      t = this.drive(midnight + 17.5 * 3600_000, weekend ? 70 : 18 + this.rand() * 2, { to: 'home', outsideC: outside - 2, launch: i % 4 === 1, place: 'work' });
      if (weekend) {
        this.setPlace(t, null);
        t = this.charge(t + 60_000, { dc: true, toSoc: 80 });
        this.setPlace(t, 'home');
      }
      if (this.soc < 62) t = this.charge(Math.max(t, midnight + 19 * 3600_000), { dc: false, toSoc: 80 });
      cursor = t;
    }
    this.park(cursor, now - 60_000, { sentry: true, tires: null });
    this.put('SoftwareUpdateVersion', '2026.38.2', now - 3600_000);
    return cursor;
  }

  // A short real-time loop so the live screens move: ~6 minutes per cycle.
  live() {
    let phase = 0;
    let t0 = Date.now();
    const tick = () => {
      const now = Date.now();
      const el = (now - t0) / 1000;
      if (phase === 0 && el > 45) {
        phase = 1; t0 = now;
        this.put('SentryMode', 'SentryModeStateOff', now);
        this.put('Gear', 'ShiftStateD', now);
        this.setPlace(now, null);
        this.put('DestinationName', 'Supercharger · Mountain View', now);
        this.speed = 0;
        this.launchAt = 12;
      } else if (phase === 1) {
        if (el < 180) {
          if (this.launchAt && el >= this.launchAt && el < this.launchAt + 3) {
            const p = (el - this.launchAt) / 2.5;
            this.speed = Math.min(70, p * 60);
            this.put('PedalPosition', 100, now);
            this.put('LongitudinalAcceleration', round(10.5 - p * 2, 2), now);
            this.put('DiTorqueActualF', 2080, now);
            this.put('DiTorqueActualREL', 2400, now);
            this.put('DiTorqueActualRER', 2350, now);
          } else {
            if (this.launchAt && el >= this.launchAt + 3) this.launchAt = null;
            this.speed = Math.max(0, this.speed + (45 - this.speed) * 0.1 + (this.rand() - 0.5) * 6);
            this.put('PedalPosition', round(this.speed / 2.2, 0), now);
            const accel = round((this.rand() - 0.5) * 2.4, 2);
            this.put('LongitudinalAcceleration', accel, now);
            this.put('BrakePedalPos', accel < -0.9 ? round(-accel * 9, 1) : 0, now);
          }
          this.put('LateralAcceleration', round((this.rand() - 0.5) * 4, 2), now);
          this.put('VehicleSpeed', round(this.speed, 1), now);
          const d = this.speed / 3600;
          this.odo += d;
          this.soc -= (d * 300) / 1000 / this.capacity * 100;
          const f = el / 180;
          this.put('Location', { latitude: HOME.lat + (WORK.lat - HOME.lat) * f, longitude: HOME.lon + (WORK.lon - HOME.lon) * f }, now);
          this.put('MinutesToArrival', round((180 - el) / 60 * 8, 1), now);
          this.put('MilesToArrival', round((180 - el) / 180 * 14.2, 1), now);
          this.put('ExpectedEnergyPercentAtTripArrival', Math.round(this.soc - 4), now);
          this.put('RouteTrafficMinutesDelay', 4, now);
          if (Math.round(el) % 10 === 0) {
            this.put('Odometer', round(this.odo, 1), now);
            this.putBattery(now);
          }
        } else {
          phase = 2; t0 = now;
          this.put('VehicleSpeed', 0, now);
          this.put('Gear', 'ShiftStateP', now);
          this.put('DestinationName', null, now);
          this.put('MinutesToArrival', null, now);
          this.put('Odometer', round(this.odo, 1), now);
          this.putBattery(now);
        }
      } else if (phase === 2 && el > 30) {
        phase = 3; t0 = now;
        this.put('FastChargerType', 'FastChargerSupercharger', now);
        this.put('DetailedChargeState', 'DetailedChargeStateCharging', now);
        this.added = 0;
      } else if (phase === 3) {
        if (el < 120 && this.soc < 80) {
          const kw = Math.max(40, Math.min(250, 250 - Math.max(0, this.soc - 20) * 3.6));
          this.added += kw / 3600 * 20; // 20x speed
          this.soc += (kw / 3600 * 20) / this.capacity * 100;
          this.put('DCChargingPower', round(kw, 1), now);
          this.put('DCChargingEnergyIn', round(this.added, 2), now);
          this.put('TimeToFullCharge', round((80 - this.soc) / 90, 2), now);
          this.putBattery(now);
        } else {
          phase = 0; t0 = now;
          this.put('DetailedChargeState', 'DetailedChargeStateComplete', now);
          this.put('DCChargingPower', 0, now);
          if (this.soc > 75) this.soc = 52;
          this.putBattery(now);
          this.put('SentryMode', 'SentryModeStateArmed', now);
        }
      }
      if (phase === 0 && Math.round(el) % 15 === 0) this.put('InsideTemp', round(20 + this.rand(), 1), now);
    };
    this.timer = setInterval(tick, 1000);
    return () => clearInterval(this.timer);
  }
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
