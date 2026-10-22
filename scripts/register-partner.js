// One-time: registers your app's domain with Tesla (POST /api/1/partner_accounts), which also
// enrolls the public key Tesla fetches from https://<domain>/.well-known/appspecific/com.tesla.3p.public-key.pem.
// Run it after that URL is reachable on the internet.
//   node scripts/register-partner.js plaid.example.com
import { config } from '../server/config.js';

const domain = process.argv[2] || new URL(config.publicUrl).hostname;
const { clientId, clientSecret, audience, tokenUrl } = config.tesla;
if (!clientId || !clientSecret) {
  console.error('Set TESLA_CLIENT_ID and TESLA_CLIENT_SECRET in .env first.');
  process.exit(1);
}

// Partner token (client_credentials): https://developer.tesla.com/docs/fleet-api/authentication/partner-tokens
const tokenRes = await fetch(tokenUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds',
    audience,
  }),
});
const token = await tokenRes.json();
if (!tokenRes.ok) {
  console.error('Partner token request failed:', tokenRes.status, JSON.stringify(token));
  process.exit(1);
}

const res = await fetch(`${audience}/api/1/partner_accounts`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ domain }),
});
console.log(res.status, await res.text());
if (res.ok) console.log(`\nNext: open https://tesla.com/_ak/${domain} on your phone to add the virtual key to the car.`);
process.exit(res.ok ? 0 : 1);
