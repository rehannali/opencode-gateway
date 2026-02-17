require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const logger = require('./logger');
const oc = require('./opencode');
const cache = require('./cache');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const modelsRoutes = require('./routes/models');
const chatRoutes = require('./routes/chat');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// HTTP request logging — piped through the leveled logger
app.use(
  morgan(':method :url :status :res[content-length]b :response-time ms', {
    stream: logger.stream,
  })
);

// Optional gateway API key protection
app.use((req, res, next) => {
  if (!config.proxyApiKey) return next();
  // Always allow health checks without auth
  if (req.path === '/health') return next();

  const key =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace('Bearer ', '');

  if (key !== config.proxyApiKey) {
    return res
      .status(401)
      .json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/models', modelsRoutes);
app.use('/', chatRoutes);

// Health — gateway + opencode status + cache info
app.get('/health', async (req, res) => {
  let opencodeHealth = null;
  try {
    opencodeHealth = await oc.health();
  } catch (e) {
    opencodeHealth = { healthy: false, error: e.message };
  }

  res.json({
    success: true,
    gateway: 'ok',
    opencode: opencodeHealth,
    model_cache: cache.meta(),
    uptime_seconds: Math.floor(process.uptime()),
    config: {
      opencode_url: config.opencodeUrl,
      server_timeout_ms: config.serverTimeout,
      cache_ttl_seconds: config.cacheTTL,
      proxy_key_enabled: !!config.proxyApiKey,
    },
    timestamp: new Date().toISOString(),
  });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  logger.info(`AI Gateway      -> http://0.0.0.0:${config.port}`);
  logger.info(`opencode server -> ${config.opencodeUrl}`);
  logger.info(`Server timeout  -> ${config.serverTimeout / 1000}s`);
  logger.info(`Model cache TTL -> ${config.cacheTTL}s`);
  logger.info(`Log level       -> ${config.logLevel}`);
});

// Long timeout for AI responses (10 min default)
server.timeout = config.serverTimeout;
server.keepAliveTimeout = config.serverTimeout;
server.headersTimeout = config.serverTimeout + 1000;

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.warn('SIGTERM received, shutting down gracefully...');
  server.close(() => process.exit(0));
});
