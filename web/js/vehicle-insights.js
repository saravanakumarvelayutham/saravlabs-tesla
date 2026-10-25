// Pure calculations over existing API summaries. No additional telemetry collection.
export const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const quantile = (a, p) => {
  const i = (a.length - 1) * p;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i % 1);
};
export function drivingInsights(trips = [], now = Date.now()) {
  // Net-gain drives and tiny trips cannot reliably predict usable range.
  const measured = trips.filter((t) => finite(t.end_ts) && t.end_ts <= now && t.end_ts >= now - 30 * 86400_000
    && finite(t.miles) && t.miles >= 1 && finite(t.kwh) && t.kwh > 0);
  const rates = measured.map((t) => t.kwh * 1000 / t.miles).sort((a, b) => a - b);
  const summarize = (list) => {
    const miles = list.reduce((s, t) => s + t.miles, 0);
    return { count: list.length, miles, wh: miles > 0 ? list.reduce((s, t) => s + t.kwh, 0) * 1000 / miles : null };
  };
  let short = summarize(measured.filter((t) => t.miles < 5));
  let long = summarize(measured.filter((t) => t.miles >= 10));
  let split = { shortMax: 5, longMin: 10, label: 'Short trips' };
  // If short errands are absent, compare the local and longer drives actually recorded.
  if (short.count < 3 || long.count < 3) {
    const local = summarize(measured.filter((t) => t.miles < 25));
    const longer = summarize(measured.filter((t) => t.miles >= 25));
    if (local.count >= 3 && longer.count >= 3) {
      short = local; long = longer; split = { shortMax: 25, longMin: 25, label: 'Local drives' };
    }
  }
  return { measured, count: measured.length,
    median: rates.length >= 5 ? quantile(rates, .5) : null,
    low: rates.length >= 5 ? quantile(rates, .25) : null,
    high: rates.length >= 5 ? quantile(rates, .75) : null, short, long, split,
    shortDelta: short.count >= 3 && long.count >= 3 ? (short.wh / long.wh - 1) * 100 : null };
}
export function rangeInsight(d, signals, now = Date.now()) {
  const energy = signals.EnergyRemaining, soc = signals.Soc;
  const fresh = (e) => finite(e?.value) && finite(e?.ts) && e.ts <= now && now - e.ts <= 15 * 60_000;
  if (!d.median || !fresh(energy) || !fresh(soc) || energy.value <= 0 || soc.value <= 0 || soc.value > 100) return null;
  if (Math.abs(energy.ts - soc.ts) > 120_000) return null;
  // Preserve 10 percentage points of current SOC without assuming a factory pack size.
  const usable = energy.value * Math.max(0, (soc.value - 10) / soc.value);
  return { typical: usable * 1000 / d.median, low: usable * 1000 / d.high,
    high: usable * 1000 / d.low, usable, ts: Math.min(energy.ts, soc.ts) };
}
export function chargingInsight(curve = []) {
  const points = curve.filter(([soc, kw]) => finite(soc) && soc >= 0 && soc <= 100 && finite(kw) && kw > 0)
    .map(([soc, kw]) => [soc, kw]).sort((a, b) => a[0] - b[0]);
  let early = points.filter(([soc]) => soc >= 20 && soc < 50);
  let late = points.filter(([soc]) => soc >= 70 && soc <= 90);
  let earlyLabel = '20–<50%', lateLabel = '70–90%';
  if ((early.length < 2 || late.length < 2) && points.length >= 6 && points.at(-1)[0] - points[0][0] >= 15) {
    const count = Math.floor(points.length / 3);
    early = points.slice(0, count); late = points.slice(-count);
    earlyLabel = `${early[0][0]}–${early.at(-1)[0]}%`;
    lateLabel = `${late[0][0]}–${late.at(-1)[0]}%`;
  }
  const mean = (rows) => rows.reduce((s, [, kw]) => s + kw, 0) / rows.length;
  if (early.length < 2 || late.length < 2) return { points, comparison: null };
  const earlyKw = mean(early), lateKw = mean(late);
  return { points, comparison: { earlyKw, lateKw, drop: (1 - lateKw / earlyKw) * 100,
    earlyBins: early.length, lateBins: late.length, earlyLabel, lateLabel, lateStart: late[0][0], lateEnd: late.at(-1)[0] } };
}
export function overnightInsight(drain, d, battery) {
  const nights = (drain?.nights || []).filter((n) => n.valid && finite(n.drain_pct));
  const on = nights.filter((n) => n.sentry), off = nights.filter((n) => !n.sentry);
  const avg = (rows) => rows.length ? rows.reduce((s, n) => s + n.drain_pct, 0) / rows.length : null;
  const onAvg = avg(on), offAvg = avg(off), capacity = battery?.latest_kwh;
  const miles = (pct) => finite(pct) && pct >= 0 && finite(capacity) && capacity > 0 && d.median
    ? pct / 100 * capacity * 1000 / d.median : null;
  return { nights, on: { count: on.length, avg: onAvg, miles: miles(onAvg) },
    off: { count: off.length, avg: offAvg, miles: miles(offAvg) },
    difference: on.length >= 2 && off.length >= 2 ? onAvg - offAvg : null };
}
