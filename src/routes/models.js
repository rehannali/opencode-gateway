const express = require('express');
const router = express.Router();
const cache = require('../cache');
const oc = require('../opencode');

/**
 * GET /models
 * Returns all models from all providers.
 * Cached for 10 minutes; auto-refreshes on next request after expiry.
 *
 * Query params:
 *   ?refresh=true        — force live fetch
 *   ?connected=false     — include models from unconfigured providers too
 */
router.get('/', async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const connectedOnly = req.query.connected !== 'false';

  const cached = forceRefresh ? null : cache.get();

  if (cached) {
    const meta = cache.meta();
    let models = cached.allModels;
    if (connectedOnly) models = models.filter((m) => m.connected);

    return res.json({
      success: true,
      source: 'cache',
      ...meta,
      total_count: models.length,
      connected_providers: cached.connected,
      by_provider: cached.byProvider,
      models,
      timestamp: new Date().toISOString(),
    });
  }

  const fetched_at = new Date().toISOString();
  const data = await oc.listAllModels();
  cache.set(data);
  const meta = cache.meta();

  let models = data.allModels;
  if (connectedOnly) models = models.filter((m) => m.connected);

  res.json({
    success: true,
    source: 'live',
    ...meta,
    fetched_at,
    total_count: models.length,
    connected_providers: data.connected,
    by_provider: data.byProvider,
    models,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /models/:providerId
 * Models for a specific provider only.
 * Example: GET /models/copilot
 */
router.get('/:providerId', async (req, res) => {
  const { providerId } = req.params;

  const cached = cache.get();
  if (cached?.byProvider?.[providerId]) {
    const p = cached.byProvider[providerId];
    return res.json({
      success: true,
      source: 'cache',
      provider: providerId,
      connected: p.connected,
      count: p.model_count,
      models: p.models,
      timestamp: new Date().toISOString(),
    });
  }

  const data = await oc.listAllModels();
  cache.set(data);

  const p = data.byProvider[providerId];
  if (!p) {
    return res.status(404).json({
      success: false,
      error: `Provider '${providerId}' not found`,
      available_providers: Object.keys(data.byProvider),
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    success: true,
    source: 'live',
    provider: providerId,
    connected: p.connected,
    count: p.model_count,
    models: p.models,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
