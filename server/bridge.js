// Garage Pi status: when the Pi last checked in and when it last reached the car over Bluetooth.
// The Pi only reads state; the app sends no commands to the car.

const BRIDGE_FRESH_MS = 2 * 60_000;

export class Bridge {
  constructor() {
    this.seen = 0;
    this.reachedCar = 0;
    this.sleep = null;
  }

  status() {
    return {
      online: Date.now() - this.seen < BRIDGE_FRESH_MS,
      car_in_range: Date.now() - this.reachedCar < BRIDGE_FRESH_MS,
      last_seen: this.seen || null,
      last_car_contact: this.reachedCar || null,
      sleep: this.sleep,
    };
  }
}
