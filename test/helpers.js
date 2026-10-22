import { openDb } from '../server/db.js';
import { Store } from '../server/store.js';

export function memStore() {
  const db = openDb(':memory:');
  return { db, store: new Store(db) };
}

// Feeds [field, value, minutesFromT0] triples in order.
export function feed(store, t0, rows, source = 'TEL') {
  for (const [f, v, min] of rows) store.put(f, v, t0 + min * 60_000, source);
}
