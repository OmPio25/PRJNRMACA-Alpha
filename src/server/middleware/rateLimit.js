'use strict';
/**
 * Rate limiter in-memory sederhana untuk percobaan login.
 * 5 kegagalan dalam 5 menit per kombinasi email+IP.
 */
const config = require('../config');

const buckets = new Map();

function keyFor(email, ip) {
  return `${String(email || '').toLowerCase().trim()}|${ip || 'unknown'}`;
}

function prune(now) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function check(email, ip, now = Date.now()) {
  const key = keyFor(email, ip);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return { allowed: true, remaining: config.loginMaxFailures };
  if (bucket.count >= config.loginMaxFailures) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: bucket.resetAt - now,
    };
  }
  return { allowed: true, remaining: config.loginMaxFailures - bucket.count };
}

function recordFailure(email, ip, now = Date.now()) {
  const key = keyFor(email, ip);
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + config.loginWindowMs });
    return 1;
  }
  bucket.count += 1;
  return bucket.count;
}

function reset(email, ip) {
  buckets.delete(keyFor(email, ip));
}

module.exports = { check, recordFailure, reset, keyFor };
