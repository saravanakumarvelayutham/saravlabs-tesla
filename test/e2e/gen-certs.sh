#!/usr/bin/env bash
# Makes every key and certificate the e2e stack needs, in the same places the production
# stack reads them from (deploy/config/...). Proxy and virtual-key commands are copied from
# docs/SETUP.md so the documented steps get exercised too.
#   gen-certs.sh <deploy dir> <e2e certs dir> <VIN>
set -euo pipefail
DEPLOY=$1 OUT=$2 VIN=$3
P=$DEPLOY/config/proxy T=$DEPLOY/config/telemetry
mkdir -p "$P" "$T" "$OUT"
q() { "$@" >/dev/null 2>&1; }

# --- docs/SETUP.md: virtual key ---
q openssl ecparam -name prime256v1 -genkey -noout -out "$P/fleet-key.pem"
q openssl ec -in "$P/fleet-key.pem" -pubout -out "$P/fleet-key-public.pem"

# --- docs/SETUP.md: proxy TLS certificate ---
q openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:secp384r1 -pkeyopt ec_param_enc:named_curve \
  -subj '/CN=tesla-proxy' -addext "subjectAltName=DNS:tesla-proxy,DNS:localhost" \
  -keyout "$P/tls-key.pem" -out "$P/tls-cert.pem" -sha256 -days 3650 \
  -addext "extendedKeyUsage = serverAuth" -addext "keyUsage = digitalSignature, keyCertSign, keyAgreement"

# --- Telemetry server certificate: a private CA standing in for the public CA you'd use ---
q openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -subj '/CN=e2e telemetry CA' \
  -keyout "$OUT/telemetry-ca-key.pem" -out "$T/ca.pem" -days 30 \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
q openssl req -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -subj '/CN=fleet-telemetry' \
  -keyout "$T/server-key.pem" -out "$OUT/server.csr"
printf 'subjectAltName=DNS:fleet-telemetry,DNS:localhost\nextendedKeyUsage=serverAuth\n' > "$OUT/server.ext"
q openssl x509 -req -in "$OUT/server.csr" -CA "$T/ca.pem" -CAkey "$OUT/telemetry-ca-key.pem" -set_serial "0x$(openssl rand -hex 8)" \
  -out "$T/server-cert.pem" -days 30 -extfile "$OUT/server.ext"

# --- The car's client certificate. fleet-telemetry maps an issuer CN of "Tesla Issuing CA"
# to vehicle_device (messages/identity.go) and takes the VIN from the subject CN. A real car's
# certificate chains to Tesla's CA, which fleet-telemetry has built in; this test CA is only
# trusted through tls.ca_file in the e2e copy of the server config. ---
q openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -subj '/CN=Tesla Issuing CA' \
  -keyout "$OUT/car-ca-key.pem" -out "$OUT/car-ca.pem" -days 30 \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
q openssl req -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -subj "/CN=$VIN" \
  -keyout "$OUT/car-key.pem" -out "$OUT/car.csr"
printf 'extendedKeyUsage=clientAuth\n' > "$OUT/car.ext"
q openssl x509 -req -in "$OUT/car.csr" -CA "$OUT/car-ca.pem" -CAkey "$OUT/car-ca-key.pem" -set_serial "0x$(openssl rand -hex 8)" \
  -out "$OUT/car-cert.pem" -days 30 -extfile "$OUT/car.ext"

# --- Fake Tesla endpoints and push service: one CA the proxy (SSL_CERT_FILE) and the app
# (NODE_EXTRA_CA_CERTS) trust in the e2e stack only ---
q openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -subj '/CN=e2e fakes CA' \
  -keyout "$OUT/fakes-ca-key.pem" -out "$OUT/fakes-ca.pem" -days 30 \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
q openssl req -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -subj '/CN=fakes' \
  -keyout "$OUT/fakes-key.pem" -out "$OUT/fakes.csr"
printf 'subjectAltName=DNS:fleet-api.prd.na.vn.cloud.tesla.com,DNS:fleet-auth.prd.vn.cloud.tesla.com,DNS:push.e2e.test\nextendedKeyUsage=serverAuth\n' > "$OUT/fakes.ext"
q openssl x509 -req -in "$OUT/fakes.csr" -CA "$OUT/fakes-ca.pem" -CAkey "$OUT/fakes-ca-key.pem" -set_serial "0x$(openssl rand -hex 8)" \
  -out "$OUT/fakes-cert.pem" -days 30 -extfile "$OUT/fakes.ext"
# Go reads SSL_CERT_FILE instead of the system bundle, so give the proxy the system roots too.
cat /etc/ssl/certs/ca-certificates.crt "$OUT/fakes-ca.pem" > "$OUT/proxy-roots.pem" 2>/dev/null || cp "$OUT/fakes-ca.pem" "$OUT/proxy-roots.pem"

# The proxy and fleet-telemetry images run as uid 65532, so mounted keys must be readable.
chmod 644 "$P"/*.pem "$T"/*.pem "$OUT"/*.pem
echo "certificates written to $DEPLOY/config and $OUT"
