const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const oc = require('../opencode');
const logger = require('../logger');

/**
 * POST /chat
 *
 * Main n8n-friendly chat endpoint. Supports two input formats:
 *
 * Simple (recommended for n8n):
 *   { "prompt": "...", "model": "copilot/gpt-4o" }
 *
 * OpenAI-compatible:
 *   { "messages": [{"role":"user","content":"..."}], "model": "copilot/gpt-4o" }
 *
 * Model format is always "provider/modelId".
 *
 * Optional fields:
 *   system        — system prompt
 *   session_id    — continue a previous conversation
 *   keep_session  — if true, don't delete session after response (for multi-turn)
 *   title         — session title (for debugging / session list)
 *
 * Response:
 *   { success, request_id, session_id, model, provider, message, usage, elapsed_ms, ... }
 */
router.post('/chat', async (req, res) => {
  const {
    prompt,
    messages,
    model,
    system,
    session_id,
    keep_session = false,
    title,
  } = req.body;

  // Resolve user text from either format
  let userText = prompt || null;
  let systemText = system || null;

  if (!userText && Array.isArray(messages)) {
    userText = messages
      .filter((m) => m.role !== 'system')
      .map((m) => m.content)
      .join('\n');

    if (!systemText) {
      const sysMsg = messages.find((m) => m.role === 'system');
      if (sysMsg) systemText = sysMsg.content;
    }
  }

  if (!userText) {
    return res.status(400).json({
      success: false,
      error: "Provide 'prompt' (string) or 'messages' (array of {role, content})",
      timestamp: new Date().toISOString(),
    });
  }

  const requestId = uuidv4();
  const startedAt = Date.now();
  let sessionId = session_id;
  let createdSession = false;

  if (!sessionId) {
    const session = await oc.createSession(
      title || `req-${requestId.slice(0, 8)}`
    );
    sessionId = session.id;
    createdSession = true;
  }

  logger.info(`[${requestId}] chat -> session=${sessionId} model=${model || 'default'}`);
  logger.debug(`[${requestId}] prompt length=${userText.length} chars keep_session=${keep_session}`);

  try {
    const result = await oc.sendMessage(sessionId, userText, model, systemText);

    const text = oc.extractText(result.parts);
    const usage = oc.extractUsage(result.info);
    const elapsed = Date.now() - startedAt;
    const usedModel = result.info?.model || model || null;
    const provider = usedModel ? usedModel.split('/')[0] : null;

    logger.info(
      `[${requestId}] done model=${usedModel || 'unknown'} ` +
      `tokens=${usage.total_tokens || 0} elapsed=${elapsed}ms`
    );

    res.json({
      success: true,
      request_id: requestId,
      session_id: sessionId,
      model: usedModel,
      provider,
      message: text,
      usage,
      elapsed_ms: elapsed,
      parts: result.parts,
      timestamp: new Date().toISOString(),
    });
  } finally {
    if (createdSession && !keep_session) {
      oc.deleteSession(sessionId).catch(() => {});
    }
  }
});

/**
 * POST /v1/chat/completions
 *
 * OpenAI-SDK compatible endpoint. Point any OpenAI library at this gateway
 * and it will route through opencode.
 *
 * Supports x-provider header to force a provider, otherwise uses the model prefix.
 */
router.post('/v1/chat/completions', async (req, res) => {
  const { model, messages, system, max_tokens } = req.body;

  const sysMsg =
    system || (messages || []).find((m) => m.role === 'system')?.content;
  const userMessages = (messages || []).filter((m) => m.role !== 'system');
  const userText = userMessages.map((m) => m.content).join('\n');

  if (!userText) {
    return res
      .status(400)
      .json({ error: 'No user message found in messages array' });
  }

  const session = await oc.createSession();
  try {
    const result = await oc.sendMessage(session.id, userText, model, sysMsg);
    const text = oc.extractText(result.parts);
    const usage = oc.extractUsage(result.info);
    const usedModel = result.info?.model || model || 'unknown';

    res.json({
      id: `chatcmpl-${uuidv4()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: usedModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: usage.input_tokens || 0,
        completion_tokens: usage.output_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
    });
  } finally {
    oc.deleteSession(session.id).catch(() => {});
  }
});

/**
 * GET /sessions
 * List recent opencode sessions (useful for multi-turn conversations in n8n).
 */
router.get('/sessions', async (req, res) => {
  const all = await oc.listSessions();
  const limit = parseInt(req.query.limit || '20');
  const sessions = all.slice(0, limit);
  res.json({
    success: true,
    count: sessions.length,
    sessions,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
