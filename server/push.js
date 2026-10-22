// Web push with VAPID. On iPhone this works only for a web app added to the Home Screen
// (iOS/iPadOS 16.4+, https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
import webpush from 'web-push';

export class Push {
  constructor(db, { publicKey, privateKey, subject }) {
    this.db = db;
    this.enabled = Boolean(publicKey && privateKey);
    this.publicKey = publicKey;
    if (this.enabled) webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  subscribe(sub) {
    if (!sub?.endpoint) throw new Error('subscription needs an endpoint');
    this.db.prepare('INSERT INTO push_subs (endpoint, sub, created) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET sub = excluded.sub')
      .run(sub.endpoint, JSON.stringify(sub), Date.now());
  }

  unsubscribe(endpoint) {
    this.db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n;
  }

  async send(payload) {
    if (!this.enabled) return { sent: 0, skipped: 'VAPID keys not set' };
    const subs = this.db.prepare('SELECT endpoint, sub FROM push_subs').all();
    let sent = 0;
    await Promise.all(subs.map(async (row) => {
      try {
        await webpush.sendNotification(JSON.parse(row.sub), JSON.stringify(payload), { TTL: 3600 });
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) this.unsubscribe(row.endpoint);
        else console.warn('[push] send failed', err.statusCode || err.message);
      }
    }));
    return { sent };
  }
}
