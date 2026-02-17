const NodeCache = require('node-cache');
const config = require('./config');

// Model cache: auto-expires after cacheTTL seconds, checks every 60s
const store = new NodeCache({
  stdTTL: config.cacheTTL,
  checkperiod: 60,
  useClones: false,
});

const KEY = 'models_v1';

module.exports = {
  get() {
    return store.get(KEY) || null;
  },

  set(data) {
    store.set(KEY, data);
  },

  meta() {
    const ttl = store.getTtl(KEY);
    return {
      cached: store.has(KEY),
      cache_expires_at: ttl ? new Date(ttl).toISOString() : null,
      cache_ttl_remaining_seconds: ttl
        ? Math.round((ttl - Date.now()) / 1000)
        : 0,
    };
  },

  invalidate() {
    store.del(KEY);
  },
};
