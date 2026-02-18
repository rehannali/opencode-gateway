const express = require('express');
const router = express.Router();
const oc = require('../opencode');

/**
 * GET /auth/status
 * Shows which providers are connected and available auth methods.
 */
router.get('/status', async (req, res) => {
  const data = await oc.listProviders();
  let methods = {};
  try {
    methods = await oc.getAuthMethods();
  } catch (_) {
    // Some opencode versions may not expose this
  }

  const providers = (data.all || []).map((p) => ({
    id: p.id,
    name: p.name || p.id,
    connected: (data.connected || []).includes(p.id),
    auth_methods: methods[p.id] || [],
    model_count: (p.models || []).length,
  }));

  res.json({
    success: true,
    connected: data.connected || [],
    providers,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /auth/:providerId/oauth/start
 *
 * Start OAuth device-flow or browser-flow for a provider.
 * Works for: copilot, openai (ChatGPT Plus/Pro), anthropic (Claude Pro/Max)
 *
 * Optional body: { "method": <number> }
 * If omitted, the gateway auto-detects the correct method from opencode's
 * /provider/auth endpoint. Pass method explicitly only if auto-detect fails.
 *
 * Example: POST /auth/copilot/oauth/start
 * Example: POST /auth/copilot/oauth/start  { "method": 0 }
 */
router.post('/:providerId/oauth/start', async (req, res) => {
  const { providerId } = req.params;
  const { method } = req.body || {};
  const result = await oc.startOAuth(providerId, method);

  // Preserve all fields from opencode (including `instructions` which contains
  // the user code for device-code flows). Only add our own helper fields on top.
  const response = {
    success: true,
    provider: providerId,
    ...result,
    timestamp: new Date().toISOString(),
  };

  // For device-code / "auto" flow (GitHub Copilot): opencode polls in the background.
  // The user code to enter at github.com/login/device is in result.instructions.
  if (result.method === 'auto' && result.url) {
    response.steps = [
      `1. Open: ${result.url}`,
      `2. Enter the code shown in the "instructions" field above`,
      '3. Authorize in GitHub',
      '4. Authorization completes automatically — opencode polls in the background',
      `5. Verify with GET /auth/status or call POST /auth/${providerId}/oauth/callback if needed`,
    ];
  } else if (result.userCode || result.user_code) {
    response.steps = [
      `1. Open: ${result.verificationUrl || result.verification_uri || result.url}`,
      `2. Enter code: ${result.userCode || result.user_code}`,
      '3. Authorize the application',
      `4. Call POST /auth/${providerId}/oauth/callback`,
    ];
  } else if (result.url) {
    response.steps = [
      `1. Open this URL in your browser: ${result.url}`,
      '2. Authenticate and approve',
      `3. If prompted, finalize via POST /auth/${providerId}/oauth/callback`,
    ];
  }

  res.json(response);
});

/**
 * POST /auth/:providerId/oauth/callback
 * Complete the OAuth flow after user has authorized.
 */
router.post('/:providerId/oauth/callback', async (req, res) => {
  const { providerId } = req.params;
  const result = await oc.oauthCallback(providerId, req.body);
  res.json({
    success: true,
    provider: providerId,
    result,
    message: `OAuth completed for '${providerId}'`,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /auth/:providerId/apikey
 * Set an API key for any provider directly.
 *
 * Body: { "apiKey": "sk-..." }
 * Works for: openai, anthropic, groq, openrouter, deepseek, xai, etc.
 */
router.post('/:providerId/apikey', async (req, res) => {
  const { providerId } = req.params;
  const { apiKey } = req.body;
  if (!apiKey) {
    return res
      .status(400)
      .json({ success: false, error: 'apiKey is required in the body' });
  }

  await oc.setAuth(providerId, { apiKey });
  res.json({
    success: true,
    provider: providerId,
    message: `API key saved for provider '${providerId}'`,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
