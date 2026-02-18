const express = require('express');
const router = express.Router();
const oc = require('../opencode');

/**
 * GET /auth/status
 * Shows which providers are connected and available auth methods.
 */
router.get('/status', async (req, res, next) => {
  try {
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
  } catch (err) {
    next(err);
  }
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
router.post('/:providerId/oauth/start', async (req, res, next) => {
  try {
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

    const authTarget =
      providerId === 'copilot'
        ? 'GitHub'
        : providerId === 'openai'
          ? 'OpenAI'
          : 'the provider';

    const isPkceFlow =
      result.url &&
      (result.url.includes('code_challenge') ||
        (!result.userCode && !result.user_code));

    if (result.userCode || result.user_code) {
      // Device-code flow (GitHub Copilot): user enters a short code at a URL
      response.steps = [
        `1. Open: ${result.verificationUrl || result.verification_uri || result.url}`,
        `2. Enter code: ${result.userCode || result.user_code}`,
        `3. Authorize in ${authTarget}`,
        '4. Token saved automatically — opencode polls in the background (no callback needed)',
        '5. Verify success: GET /auth/status',
      ];
    } else if (isPkceFlow) {
      // PKCE browser flow (OpenAI, Anthropic, etc.):
      // opencode starts an internal listener on port 1455 inside its container.
      // Because the redirect_uri is localhost:1455, the browser redirect won't reach
      // opencode directly when it's running in Docker. Use the gateway's /auth/callback
      // endpoint to proxy the code back to opencode.
      response.steps = [
        `1. Open this URL in your browser: ${result.url}`,
        `2. Complete authorization in ${authTarget}`,
        '3. Your browser will be redirected to localhost:1455/auth/callback?code=...&state=...',
        '   That page will fail to load (expected — opencode is in Docker, not on your machine)',
        '4. Copy the FULL URL from your browser address bar',
        '5. Replace "localhost:1455" with your gateway address and call it as a GET request:',
        '   GET /auth/callback?code=<CODE>&state=<STATE>',
        '   (copy the code= and state= values from the URL in step 4)',
        '6. Verify success: GET /auth/status',
      ];
    } else if (result.url) {
      response.steps = [
        `1. Open this URL in your browser: ${result.url}`,
        '2. Authenticate and approve',
        `3. If prompted, finalize via POST /auth/${providerId}/oauth/callback`,
      ];
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/callback
 *
 * Browser-facing OAuth callback proxy for PKCE flows (OpenAI, Anthropic, etc.)
 *
 * When opencode starts a PKCE browser flow it sets redirect_uri=localhost:1455/auth/callback
 * and spins up a temporary HTTP server on that port inside its container.
 * Since the container's port 1455 is not publicly reachable, this endpoint
 * accepts the browser redirect and proxies the code + state to opencode's
 * internal listener so the token exchange can complete.
 *
 * Usage: GET /auth/callback?code=<CODE>&state=<STATE>
 * (copy these values from the localhost:1455/auth/callback URL in your browser)
 */
router.get('/callback', async (req, res, next) => {
  try {
    if (!req.query.code) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query param: code',
        hint: 'Copy the full URL from your browser after OAuth redirect and call GET /auth/callback?code=...&state=...',
      });
    }

    const { status, data } = await oc.proxyOAuthCallback(req.query);

    if (status >= 200 && status < 300) {
      res.json({
        success: true,
        message: 'OAuth callback delivered to opencode successfully',
        result: data,
        next: 'Verify with GET /auth/status',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(status).json({
        success: false,
        error: 'opencode listener returned an error',
        details: data,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/:providerId/oauth/callback
 * Complete the OAuth flow after user has authorized (device-code flows).
 */
router.post('/:providerId/oauth/callback', async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const result = await oc.oauthCallback(providerId, req.body);
    res.json({
      success: true,
      provider: providerId,
      result,
      message: `OAuth completed for '${providerId}'`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/:providerId/apikey
 * Set an API key for any provider directly.
 *
 * Body: { "apiKey": "sk-..." }
 * Works for: openai, anthropic, groq, openrouter, deepseek, xai, etc.
 */
router.post('/:providerId/apikey', async (req, res, next) => {
  try {
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
  } catch (err) {
    next(err);
  }
});

module.exports = router;
