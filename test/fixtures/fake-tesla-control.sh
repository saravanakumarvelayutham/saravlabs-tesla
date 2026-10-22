#!/bin/sh
# Stands in for `tesla-control -ble -vin V -key-file K <command> [args]` in tests.
shift 5
echo "$@" >> "$FAKE_LOG"
case "$1" in
  body-controller-state) echo '{"vehicleLockState":"VEHICLELOCKSTATE_LOCKED","vehicleSleepStatus":"VEHICLE_SLEEP_STATUS_AWAKE"}' ;;
  state) [ "$2" = charge ] && echo '{"chargeState":{"usableBatteryLevel":64,"chargeLimitSoc":80}}' || echo '{}' ;;
  *) ;;
esac
