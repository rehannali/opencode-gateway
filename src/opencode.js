/**
 * opencode.js — HTTP client for the opencode headless server API.
 *
 * opencode CLI (https://opencode.ai) handles all provider auth, model
 * routing, sessions, and tool use. This module wraps its REST API so
 * the Node.js gateway can proxy requests to it.
 *
 * API docs: https://opencode.ai/docs/server
 */

const axios = require('axios');
const config = require('./config');

const client = axios.create({
  baseURL: config.opencodeUrl,
  timeout: config.serverTimeout,
  headers: {
    'Content-Type': 'application/json',
    ...(config.opencodePassword && {
      Authorization:
        'Basic ' +
        Buffer.from(`opencode:${config.opencodePassword}`).toString('base64'),
    }),
  },
});

// ── Health ────────────────────────────────────────────────────────────────────

async function health() {
  const r = await client.get('/global/health');
  return r.data;
}

// ── Providers & Models ────────────────────────────────────────────────────────

async function listProviders() {
  const r = await client.get('/provider');
  return r.data;
}

/**
 * Flatten all models across all providers into a simple array.
 * Marks each model with its provider and whether that provider is connected.
 */
async function listAllModels() {
  const data = await listProviders();
  const connected = new Set(data.connected || []);

  const byProvider = {};
  const allModels = [];

  for (const provider of data.all || []) {
    const models = (provider.models || []).map((m) => ({
      id: `${provider.id}/${m.id}`,
      model_id: m.id,
      provider_id: provider.id,
      provider_name: provider.name || provider.id,
      name: m.name || m.id,
      connected: connected.has(provider.id),
      context_length: m.limit?.context || null,
      max_output_tokens: m.limit?.output || null,
      release_date: m.releaseDate || null,
      reasoning: m.reasoning || false,
    }));

    byProvider[provider.id] = {
      name: provider.name || provider.id,
      connected: connected.has(provider.id),
      model_count: models.length,
      models,
    };

    allModels.push(...models);
  }

  return { byProvider, allModels, connected: [...connected] };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getAuthMethods() {
  const r = await client.get('/provider/auth');
  return r.data;
}

/**
 * Start OAuth for a provider.
 * GitHub Copilot  -> device flow (returns userCode + verificationUrl)
 * OpenAI/Anthropic -> browser flow (returns url)
 */
async function startOAuth(providerId) {
  const r = await client.post(`/provider/${providerId}/oauth/authorize`, {});
  return r.data;
}

async function oauthCallback(providerId, body) {
  const r = await client.post(`/provider/${providerId}/oauth/callback`, body);
  return r.data;
}

/**
 * Set an API key for a provider directly.
 * PUT /auth/:id — body depends on the provider (usually { apiKey: "..." })
 */
async function setAuth(providerId, body) {
  const r = await client.put(`/auth/${providerId}`, body);
  return r.data;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

async function createSession(title) {
  const r = await client.post('/session', {
    title: title || 'gateway-session',
  });
  return r.data;
}

async function deleteSession(sessionId) {
  const r = await client.delete(`/session/${sessionId}`);
  return r.data;
}

async function listSessions() {
  const r = await client.get('/session');
  return Array.isArray(r.data) ? r.data : [];
}

// ── Messages ──────────────────────────────────────────────────────────────────

/**
 * Send a message to a session and BLOCK until opencode responds fully.
 * This can take minutes for complex queries — the server timeout handles it.
 */
async function sendMessage(sessionId, text, model, system) {
  const body = {
    parts: [{ type: 'text', text }],
    ...(model && { model }),
    ...(system && { system }),
  };

  const r = await client.post(`/session/${sessionId}/message`, body, {
    timeout: config.serverTimeout,
  });
  return r.data;
}

async function getMessages(sessionId, limit) {
  const params = limit ? { limit } : {};
  const r = await client.get(`/session/${sessionId}/message`, { params });
  return r.data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(parts) {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text || '')
    .join('');
}

function extractUsage(info) {
  if (!info) return {};
  return {
    input_tokens: info.tokens?.input || 0,
    output_tokens: info.tokens?.output || 0,
    total_tokens: (info.tokens?.input || 0) + (info.tokens?.output || 0),
    cost_usd: info.cost || null,
  };
}

module.exports = {
  health,
  listProviders,
  listAllModels,
  getAuthMethods,
  startOAuth,
  oauthCallback,
  setAuth,
  createSession,
  deleteSession,
  listSessions,
  sendMessage,
  getMessages,
  extractText,
  extractUsage,
};
