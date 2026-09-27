// Sliding-window limiter kept in memory: at most `max` allowed hits per key per `windowMs`.
// Only allowed hits are recorded, so a blocked client is let back in exactly one window after
// its earliest hit rather than being punished for retrying.
export function createRateLimiter({ max, windowMs, now = Date.now, maxKeys = 10000 }) {
  const hits = new Map(); // key -> ascending timestamps

  function prune(list, t) {
    let i = 0;
    while (i < list.length && list[i] <= t - windowMs) i++;
    if (i) list.splice(0, i);
  }

  function sweep() {
    const t = now();
    for (const [key, list] of hits) {
      prune(list, t);
      if (list.length === 0) hits.delete(key);
    }
  }

  function hit(key) {
    const t = now();
    let list = hits.get(key);
    if (!list) {
      if (hits.size >= maxKeys) {
        sweep();
        // Still full of live entries: drop the oldest key rather than grow without bound.
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
      }
      list = [];
      hits.set(key, list);
    }
    prune(list, t);
    if (list.length >= max) {
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000)) };
    }
    list.push(t);
    return { allowed: true, remaining: max - list.length, retryAfterSec: 0 };
  }

  const timer = setInterval(sweep, Math.min(windowMs, 60000));
  timer.unref();

  return { hit, sweep, stop: () => clearInterval(timer), size: () => hits.size };
}
