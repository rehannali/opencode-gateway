require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000'),

  // 10 minutes — enough for long-running AI queries
  serverTimeout: parseInt(process.env.SERVER_TIMEOUT || '600000'),

  // Optional: protect this gateway with a key
  proxyApiKey: process.env.PROXY_API_KEY || null,

  // opencode headless server connection
  opencodeUrl: process.env.OPENCODE_URL || 'http://localhost:4096',
  opencodePassword: process.env.OPENCODE_SERVER_PASSWORD || null,

  // Model cache TTL in seconds (default 10 minutes)
  cacheTTL: parseInt(process.env.CACHE_TTL || '600'),

  // Log verbosity: debug | info | warn | error  (default: info)
  logLevel: process.env.LOG_LEVEL || 'info',
};
