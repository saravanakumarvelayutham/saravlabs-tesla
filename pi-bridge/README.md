# Garage Pi bridge

When the car is parked at home, a Raspberry Pi in the garage reads its state and sends commands over Bluetooth, using Tesla's own [`tesla-control`](https://github.com/teslamotors/vehicle-command/tree/main/cmd/tesla-control). That avoids Fleet API charges and works when the car's internet connection is slow.

What it does:

- About every 60 s it runs `tesla-control -ble body-controller-state`. Tesla says this works while the car is asleep, and it doesn't wake the car. It reports lock state and whether the car is asleep.
- Only when the car is awake does it also read `state charge`, `climate`, `tire-pressure` and `closures`.
- It long-polls the server for commands. The server sends a command here when the Pi has reached the car in the last 2 minutes. If the car is asleep, the bridge sends `wake` first and waits up to 20 s.
- It only runs an allowlist of commands: lock, unlock, climate on/off, charge limit, charge start/stop, Sentry, software update, flash, honk, wake.

This hasn't been tested on a Pi with a real car yet.

## Install

1. Install Node 18+ and Go, then build `tesla-control` and `tesla-keygen` from [teslamotors/vehicle-command](https://github.com/teslamotors/vehicle-command) (`go install ./...`).
2. Make a key just for the Pi, so the server's key never leaves the server:
   ```bash
   openssl ecparam -name prime256v1 -genkey -noout -out /etc/plaid/ble-key.pem
   openssl ec -in /etc/plaid/ble-key.pem -pubout -out ble-key-public.pem
   ```
3. Pair it. Sit in the car with your key card, then run this from the Pi and tap the card on the console when the car asks:
   ```bash
   tesla-control -ble -vin YOURVIN add-key-request ble-key-public.pem owner cloud_key
   ```
4. Check it works: `tesla-control -ble -vin YOURVIN -key-file /etc/plaid/ble-key.pem body-controller-state`. If this fails with a Bluetooth permission error, run the bridge as a user that can use Bluetooth.
5. Copy `bridge.js` to `/opt/plaid-bridge/` and create `/etc/plaid-bridge.env`:
   ```
   SERVER_URL=https://plaid.example.com
   BRIDGE_TOKEN=same value as the server's BRIDGE_TOKEN
   TESLA_VIN=YOURVIN
   TESLA_KEY_FILE=/etc/plaid/ble-key.pem
   # optional: TESLA_CONTROL=/home/pi/go/bin/tesla-control  POLL_SECONDS=60
   ```
6. Install the service:
   ```bash
   sudo useradd -r plaid; sudo chown plaid /etc/plaid/ble-key.pem
   sudo cp plaid-bridge.service /etc/systemd/system/ && sudo systemctl enable --now plaid-bridge
   journalctl -u plaid-bridge -f
   ```

The dashboard's Setup page shows "Garage Pi: Online · car in range" once it's working, and readings that came over Bluetooth carry a **BLE** chip.
