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

    // Device-code flows provide the user code either in a dedicated field or
    // embedded in `instructions` (e.g. "Enter code: NC65-NP5VI"). They also
    // typically use a /device URL rather than a PKCE redirect URL.
    const codeFromInstructions =
      result.instructions &&
      result.instructions.match(/enter code[:\s]+([A-Z0-9-]{4,})/i)?.[1];
    const userCode = result.userCode || result.user_code || codeFromInstructions;

    const isDeviceCodeFlow =
      userCode ||
      (result.url && result.url.includes('/device'));

    const isPkceFlow =
      !isDeviceCodeFlow && result.url && result.url.includes('code_challenge');

    if (isDeviceCodeFlow) {
      // Device-code flow (GitHub Copilot, OpenAI headless, etc.):
      // opencode polls in the background — no callback needed.
      response.steps = [
        `1. Open: ${result.verificationUrl || result.verification_uri || result.url}`,
        `2. Enter code: ${userCode || '(see "instructions" field above)'}`,
        `3. Authorize in ${authTarget}`,
        '4. Token saved automatically — opencode polls in the background (no callback needed)',
        '5. Verify success: GET /auth/status (may take up to 60 seconds)',
      ];
    } else if (isPkceFlow) {
      // PKCE browser flow (OpenAI, Anthropic, etc.):
      // opencode starts an internal listener on port 1455 inside its container.
      // Because the redirect_uri is localhost:1455, the browser redirect won't reach
      // opencode directly when it's running in Docker. Use the gateway's /auth/callback
      // endpoint to proxy the code back to opencode.
      //
      // ⚠️  Authorization codes expire in ~5 minutes — complete ALL steps within that window.
      response.warning =
        '⚠️  IMPORTANT: authorization codes expire in ~5 minutes. Complete steps 1-5 immediately.';
      response.steps = [
        `1. Open this URL in your browser RIGHT NOW: ${result.url}`,
        `2. Complete authorization in ${authTarget}`,
        '3. Your browser will be redirected to localhost:1455/auth/callback?code=...&state=...',
        '   That page will fail to load — that is expected (opencode is in Docker)',
        '4. Immediately copy the FULL URL from your browser address bar',
        '5. Within ~5 min of step 1, call the gateway with the code and state from that URL:',
        '   GET /auth/callback?code=<CODE>&state=<STATE>',
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
 * GET|POST /auth/callback
 *
 * Browser-facing OAuth callback proxy for PKCE flows (OpenAI, Anthropic, etc.)
 *
 * When opencode starts a PKCE browser flow it sets redirect_uri=localhost:1455/auth/callback
 * and spins up a temporary HTTP server on that port inside its container.
 * Since the container's port 1455 is not publicly reachable, this endpoint
 * accepts the browser redirect and proxies the code + state to opencode's
 * internal listener so the token exchange can complete.
 *
 * Usage: GET  /auth/callback?code=<CODE>&state=<STATE>
 *        POST /auth/callback?code=<CODE>&state=<STATE>
 * (copy these values from the localhost:1455/auth/callback URL in your browser)
 */
async function handleOAuthCallback(req, res, next) {
  try {
    // Merge query params from both the URL and the body so either approach works
    const params = { ...req.body, ...req.query };

    if (!params.code) {
      return res.status(400).json({
        success: false,
        error: 'Missing required param: code',
        hint: 'Copy the full URL shown in your browser after OAuth redirect and call:\n  GET /auth/callback?code=...&state=...',
      });
    }

    const { status, data } = await oc.proxyOAuthCallback(params);

    if (status >= 200 && status < 300) {
      res.json({
        success: true,
        message: 'OAuth callback delivered to opencode successfully',
        result: data,
        next: 'Verify with GET /auth/status',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(status >= 100 ? status : 500).json({
        success: false,
        error: 'opencode listener returned an error',
        details: data,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    next(err);
  }
}

router.get('/callback', handleOAuthCallback);
router.post('/callback', handleOAuthCallback);

/**
 * POST /auth/:providerId/oauth/callback
 *
 * Handles both OAuth flow types:
 *
 * 1. PKCE browser flows (OpenAI, Anthropic): when a `code` query param is
 *    present (copied from the browser's localhost:1455 redirect URL), this
 *    proxies the params to opencode's internal port-1455 listener.
 *
 * 2. Device-code flows (Copilot): no `code` param — signals opencode's REST
 *    API to poll/complete the pending device-code authorization.
 */
router.post('/:providerId/oauth/callback', async (req, res, next) => {
  try {
    const { providerId } = req.params;

    // If code is present in the query string this is a PKCE browser callback —
    // proxy it to opencode's port-1455 listener rather than the REST API.
    if (req.query.code) {
      const params = { ...req.body, ...req.query };
      const { status, data } = await oc.proxyOAuthCallback(params);

      if (status >= 200 && status < 300) {
        return res.json({
          success: true,
          provider: providerId,
          message: 'OAuth callback delivered to opencode successfully',
          result: data,
          next: 'Verify with GET /auth/status',
          timestamp: new Date().toISOString(),
        });
      }
      return res.status(status >= 100 ? status : 500).json({
        success: false,
        provider: providerId,
        error: 'opencode listener returned an error',
        details: data,
        timestamp: new Date().toISOString(),
      });
    }

    // Device-code flow: notify opencode's REST API that auth is complete
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
