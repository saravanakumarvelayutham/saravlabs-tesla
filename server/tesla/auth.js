// OAuth authorization-code flow for one owner account.
// https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens
//  - authorize: https://auth.tesla.com/oauth2/v3/authorize
//  - token:     https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token
//  - "The refresh token is single use only and expires after 3 months", so every refresh saves the new one.
import crypto from 'node:crypto';
import { kvGet, kvSet } from '../db.js';

export class TeslaAuth {
  constructor(db, tesla) {
    this.db = db;
    this.t = tesla;
    this.refreshing = null;
  }

  get linked() {
    return Boolean(kvGet(this.db, 'tesla_tokens')?.refresh_token);
  }

  loginUrl() {
    const state = crypto.randomBytes(16).toString('hex');
    kvSet(this.db, 'oauth_state', { state, ts: Date.now() });
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: this.t.clientId,
      redirect_uri: this.t.redirectUri,
      scope: this.t.scopes,
      state,
      prompt_missing_scopes: 'true',
    });
    return `${this.t.authorizeUrl}?${q}`;
  }

  async handleCallback({ code, state }) {
    const saved = kvGet(this.db, 'oauth_state');
    if (!saved || saved.state !== state || Date.now() - saved.ts > 15 * 60_000) {
      throw Object.assign(new Error('OAuth state mismatch or expired. Start again from Setup.'), { status: 400 });
    }
    kvSet(this.db, 'oauth_state', null);
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      client_id: this.t.clientId,
      client_secret: this.t.clientSecret,
      code,
      audience: this.t.audience,
      redirect_uri: this.t.redirectUri,
    });
    this.save(tokens);
  }

  async accessToken() {
    const tok = kvGet(this.db, 'tesla_tokens');
    if (!tok?.access_token) throw Object.assign(new Error('Tesla account not linked. Open /auth/login.'), { status: 401 });
    if (Date.now() < tok.expires_at - 5 * 60_000) return tok.access_token;
    this.refreshing ??= this.refresh(tok).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async refresh(tok) {
    const next = await this.tokenRequest({
      grant_type: 'refresh_token',
      client_id: this.t.clientId,
      refresh_token: tok.refresh_token,
    });
    // Refresh tokens are single use, so keep the old one only if Tesla didn't send a new one.
    this.save({ ...next, refresh_token: next.refresh_token || tok.refresh_token });
    return next.access_token;
  }

  save(t) {
    kvSet(this.db, 'tesla_tokens', {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: Date.now() + (t.expires_in || 3600) * 1000,
      scope: t.scope,
    });
  }

  async tokenRequest(params) {
    const res = await fetch(this.t.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error_description || json.error || `token request failed (${res.status})`), { status: res.status });
    return json;
  }
}
