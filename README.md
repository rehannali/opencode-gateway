# AI Gateway

A self-hosted HTTP API gateway that wraps the [opencode CLI](https://opencode.ai) to provide multi-provider AI access **without individual API keys**. Use your existing GitHub Copilot, ChatGPT Plus, or Claude Pro subscriptions as AI backends.

Built for deployment on **Dokploy** via Docker Compose, with **n8n-friendly JSON** output, **10-minute model caching**, and **10-minute server timeout** for long-running queries.

---

## Architecture

```
┌─────────────┐       ┌───────────────────────┐       ┌────────────────────┐
│             │       │                       │       │                    │
│  n8n / curl │──────>│  Gateway (Node.js)    │──────>│  opencode serve    │
│  / any HTTP │ :3000 │  - Model caching      │ :4096 │  - 75+ providers   │
│   client    │       │  - n8n-friendly JSON  │       │  - OAuth flows     │
│             │       │  - OpenAI-compatible  │       │  - Session mgmt    │
│             │       │  - Long timeout       │       │  - Tool use        │
└─────────────┘       └───────────────────────┘       └────────────────────┘
                              Docker network (internal)
```

**Two containers:**

| Container | Role | Port |
|-----------|------|------|
| `opencode-server` | Headless AI backend — handles all providers, auth, sessions, model routing | 4096 (internal) |
| `ai-gateway` | Thin Node.js HTTP wrapper — caching, simplified endpoints, n8n-friendly output | 3000 (exposed) |

**opencode** supports 75+ providers out of the box via [Models.dev](https://models.dev/). You authenticate once and all models become available through this gateway.

---

## Features

- **No API keys required** — use GitHub Copilot, ChatGPT Plus/Pro, or Claude Pro/Max subscriptions via OAuth
- **75+ providers** — Copilot, OpenAI, Anthropic, Groq, DeepSeek, OpenRouter, xAI, Ollama, and many more
- **Model cache** — `/models` endpoint caches results for 10 minutes, auto-refreshes on next request
- **Long timeout** — 10-minute server timeout handles complex AI queries without dropping connections
- **n8n-friendly** — flat JSON output with `success`, `message`, `usage`, `elapsed_ms` fields
- **OpenAI-compatible** — `/v1/chat/completions` works with any OpenAI SDK
- **Multi-turn conversations** — pass `session_id` to continue a conversation
- **Dokploy-ready** — Docker Compose with health checks, volumes, and restart policies
- **Persistent auth** — OAuth tokens saved in Docker volume, survive redeploys

---

## Quick Start

### 1. Clone and Configure

```bash
git clone https://github.com/YOUR_USERNAME/ai-gateway.git
cd ai-gateway
cp .env.example .env
# Edit .env with your preferred settings (all are optional)
```

### 2. Deploy with Docker Compose

```bash
docker compose up -d --build
```

Wait for both containers to be healthy:

```bash
docker compose ps
# Both should show "healthy"
```

### 3. Check Health

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "success": true,
  "gateway": "ok",
  "opencode": { "healthy": true, "version": "..." },
  "model_cache": { "cached": false, "cache_expires_at": null, "cache_ttl_remaining_seconds": 0 },
  "uptime_seconds": 12,
  "config": {
    "opencode_url": "http://opencode:4096",
    "server_timeout_ms": 600000,
    "cache_ttl_seconds": 600,
    "proxy_key_enabled": false
  },
  "timestamp": "2026-02-18T..."
}
```

### 4. Authenticate a Provider (one-time)

See the [Authentication](#authentication) section below for detailed instructions per provider.

### 5. Chat

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, what model are you?", "model": "copilot/gpt-4o"}'
```

---

## Authentication

Auth tokens are stored inside the `opencode-share` Docker volume and persist across container restarts and redeploys. You only need to authenticate **once per provider**.

### GitHub Copilot (no API key needed)

Requires an active [GitHub Copilot subscription](https://github.com/features/copilot).

**Step 1 — Start device flow:**
```bash
curl -X POST http://localhost:3000/auth/copilot/oauth/start
```

Response:
```json
{
  "success": true,
  "provider": "copilot",
  "userCode": "XXXX-XXXX",
  "verificationUrl": "https://github.com/login/device",
  "instructions": [
    "1. Open: https://github.com/login/device",
    "2. Enter code: XXXX-XXXX",
    "3. Authorize the application",
    "4. Call POST /auth/copilot/oauth/callback"
  ]
}
```

**Step 2 — Open the URL in your browser**, enter the code, and authorize.

**Step 3 — Complete auth:**
```bash
curl -X POST http://localhost:3000/auth/copilot/oauth/callback \
  -H "Content-Type: application/json" \
  -d '{}'
```

### ChatGPT Plus / Pro (no API key needed)

Requires an active [ChatGPT Plus or Pro subscription](https://chatgpt.com/pricing).

```bash
curl -X POST http://localhost:3000/auth/openai/oauth/start
```

Follow the instructions returned in the response to authenticate via your browser.

### Claude Pro / Max (no API key needed)

Requires an active [Claude Pro or Max subscription](https://claude.ai/pricing).

```bash
curl -X POST http://localhost:3000/auth/anthropic/oauth/start
```

Follow the instructions returned in the response to authenticate via your browser.

### API Key Providers

For providers that use API keys (Groq, OpenRouter, DeepSeek, xAI, etc.):

**Option A — Set via API:**
```bash
curl -X POST http://localhost:3000/auth/groq/apikey \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "gsk_..."}'
```

**Option B — Set via environment variable in `.env`:**
```bash
GROQ_API_KEY=gsk_...
```

Then restart: `docker compose up -d`

### Check Auth Status

```bash
curl http://localhost:3000/auth/status
```

Response:
```json
{
  "success": true,
  "connected": ["copilot", "groq"],
  "providers": [
    {
      "id": "copilot",
      "name": "GitHub Copilot",
      "connected": true,
      "model_count": 15
    },
    {
      "id": "groq",
      "name": "Groq",
      "connected": true,
      "model_count": 8
    },
    {
      "id": "anthropic",
      "name": "Anthropic",
      "connected": false,
      "model_count": 6
    }
  ]
}
```

---

## API Reference

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Gateway + opencode health, cache status, config |

---

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/status` | List all providers and their connection status |
| `POST` | `/auth/:provider/oauth/start` | Start OAuth flow (Copilot, OpenAI, Anthropic) |
| `POST` | `/auth/:provider/oauth/callback` | Complete OAuth flow |
| `POST` | `/auth/:provider/apikey` | Set API key. Body: `{"apiKey": "..."}` |

**Supported OAuth providers:** `copilot`, `openai`, `anthropic`

**Supported API key providers:** `openai`, `anthropic`, `groq`, `openrouter`, `deepseek`, `xai`, `together-ai`, `fireworks-ai`, `cerebras`, and [70+ more](https://opencode.ai/docs/providers/)

---

### Models

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/models` | All models from all providers (cached 10 min) |
| `GET` | `/models?refresh=true` | Force cache refresh |
| `GET` | `/models?connected=false` | Include models from unconfigured providers |
| `GET` | `/models/:provider` | Models from a specific provider |

**Example — List all models:**
```bash
curl http://localhost:3000/models
```

Response:
```json
{
  "success": true,
  "source": "cache",
  "cached": true,
  "cache_expires_at": "2026-02-18T12:10:00.000Z",
  "cache_ttl_remaining_seconds": 540,
  "total_count": 23,
  "connected_providers": ["copilot", "groq"],
  "models": [
    {
      "id": "copilot/gpt-4o",
      "model_id": "gpt-4o",
      "provider_id": "copilot",
      "provider_name": "GitHub Copilot",
      "name": "GPT-4o",
      "connected": true,
      "context_length": 128000,
      "max_output_tokens": 16384
    },
    {
      "id": "copilot/claude-sonnet-4",
      "model_id": "claude-sonnet-4",
      "provider_id": "copilot",
      "provider_name": "GitHub Copilot",
      "name": "Claude Sonnet 4",
      "connected": true,
      "context_length": 200000,
      "max_output_tokens": 65536
    }
  ]
}
```

**Example — Models from one provider:**
```bash
curl http://localhost:3000/models/copilot
```

---

### Chat

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | n8n-friendly chat (recommended) |
| `POST` | `/v1/chat/completions` | OpenAI-SDK compatible endpoint |
| `GET` | `/sessions` | List recent sessions |

#### POST /chat

The main endpoint. Designed for simplicity in n8n and other automation tools.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes* | The user message |
| `messages` | array | Yes* | OpenAI-format messages array (alternative to `prompt`) |
| `model` | string | No | Model in `provider/modelId` format (e.g. `copilot/gpt-4o`) |
| `system` | string | No | System prompt |
| `session_id` | string | No | Continue a previous conversation |
| `keep_session` | boolean | No | If true, don't delete session after response (for multi-turn) |
| `title` | string | No | Session title for debugging |

\* Provide either `prompt` or `messages`, not both.

**Simple prompt (recommended for n8n):**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain Docker volumes in 2 sentences",
    "model": "copilot/gpt-4o"
  }'
```

**With system prompt:**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is the capital of France?",
    "model": "copilot/claude-sonnet-4",
    "system": "You are a geography expert. Answer concisely."
  }'
```

**Using messages array (OpenAI format):**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is 2+2?"}
    ],
    "model": "groq/llama-3.3-70b-versatile"
  }'
```

**Multi-turn conversation:**
```bash
# First message — save the session_id
RESPONSE=$(curl -s -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "My name is Rehan",
    "model": "copilot/gpt-4o",
    "keep_session": true
  }')
SESSION_ID=$(echo $RESPONSE | jq -r '.session_id')

# Follow-up — uses the same session for context
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d "{
    \"prompt\": \"What is my name?\",
    \"model\": \"copilot/gpt-4o\",
    \"session_id\": \"$SESSION_ID\",
    \"keep_session\": true
  }"
```

**Response:**
```json
{
  "success": true,
  "request_id": "a1b2c3d4-...",
  "session_id": "s_abc123",
  "model": "copilot/gpt-4o",
  "provider": "copilot",
  "message": "Docker volumes are persistent storage mechanisms...",
  "usage": {
    "input_tokens": 20,
    "output_tokens": 45,
    "total_tokens": 65,
    "cost_usd": 0.0001
  },
  "elapsed_ms": 1823,
  "parts": [...],
  "timestamp": "2026-02-18T..."
}
```

#### POST /v1/chat/completions

Standard OpenAI-compatible endpoint. Use this to point any OpenAI SDK at the gateway.

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "copilot/gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

Response follows the standard OpenAI format:
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1708300000,
  "model": "copilot/gpt-4o",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "Hello! How can I help you?" },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 5,
    "completion_tokens": 12,
    "total_tokens": 17
  }
}
```

**Using with the OpenAI Python SDK:**
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="not-needed"  # or your PROXY_API_KEY if set
)

response = client.chat.completions.create(
    model="copilot/gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)
```

**Using with the OpenAI Node.js SDK:**
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'not-needed',
});

const response = await client.chat.completions.create({
  model: 'copilot/gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0].message.content);
```

---

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions` | List recent sessions |
| `GET` | `/sessions?limit=5` | Limit results |

---

## n8n Integration

### HTTP Request Node Setup

1. Add an **HTTP Request** node in n8n
2. Set method to **POST**
3. URL: `http://your-server:3000/chat`
4. Body Content Type: **JSON**
5. Body:

```json
{
  "prompt": "{{ $json.input_text }}",
  "model": "copilot/gpt-4o"
}
```

6. The response field `message` contains the AI's text response.
7. To access: `{{ $json.message }}`

### Get Available Models in n8n

1. Add an **HTTP Request** node
2. Method: **GET**
3. URL: `http://your-server:3000/models`
4. Access model list: `{{ $json.models }}`

### Multi-turn Conversation in n8n

Use `keep_session: true` and pass the `session_id` between nodes:

**Node 1 (first message):**
```json
{
  "prompt": "Analyze this data: ...",
  "model": "copilot/gpt-4o",
  "keep_session": true
}
```

**Node 2 (follow-up):**
```json
{
  "prompt": "Now summarize the key findings",
  "model": "copilot/gpt-4o",
  "session_id": "{{ $('Node 1').item.json.session_id }}",
  "keep_session": true
}
```

---

## Dokploy Deployment

### 1. Push to GitHub

```bash
cd ai-gateway
git init
git add .
git commit -m "Initial commit: AI Gateway with opencode"
git remote add origin https://github.com/YOUR_USERNAME/ai-gateway.git
git branch -M main
git push -u origin main
```

### 2. Create Application in Dokploy

1. In Dokploy dashboard, click **Create Project** > **Create Service** > **Application**
2. Select **GitHub** as the source
3. Choose your `ai-gateway` repository
4. Set **Build Type** to **Docker Compose**
5. Compose path: `./docker-compose.yml`

### 3. Set Environment Variables

In the Dokploy **Environment** tab, add any variables from `.env.example` that you need.

At minimum, no env vars are required if you plan to use OAuth (Copilot, ChatGPT Plus, etc.).

Optional but recommended:
```
OPENCODE_SERVER_PASSWORD=your-secret
PROXY_API_KEY=your-gateway-key
```

### 4. Deploy

Click **Deploy**. Dokploy will:
1. Build both Docker images
2. Start the opencode server (waits for healthcheck)
3. Start the gateway (depends on opencode being healthy)

### 5. Authenticate (one-time after first deploy)

After deployment, authenticate your preferred provider via the `/auth` endpoints (see [Authentication](#authentication) section above). The tokens are stored in a Docker volume and persist across redeploys.

---

## Model Format

Models are always referenced in `provider/modelId` format:

| Provider | Example Model | Description |
|----------|---------------|-------------|
| `copilot` | `copilot/gpt-4o` | GitHub Copilot (your subscription) |
| `copilot` | `copilot/claude-sonnet-4` | Claude via Copilot |
| `copilot` | `copilot/o3-mini` | o3-mini via Copilot |
| `openai` | `openai/gpt-4o` | Direct OpenAI API |
| `anthropic` | `anthropic/claude-sonnet-4-5-20251022` | Direct Anthropic API |
| `groq` | `groq/llama-3.3-70b-versatile` | Groq (fast inference) |
| `openrouter` | `openrouter/meta-llama/llama-3.3-70b` | OpenRouter (many models) |
| `deepseek` | `deepseek/deepseek-chat` | DeepSeek |

Use `GET /models` to see all available models from your connected providers.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_PORT` | `3000` | Port the gateway listens on |
| `PROXY_API_KEY` | _(none)_ | Optional API key to protect the gateway |
| `SERVER_TIMEOUT` | `600000` | Request timeout in ms (10 min) |
| `CACHE_TTL` | `600` | Model cache lifetime in seconds (10 min) |
| `OPENCODE_SERVER_PASSWORD` | _(none)_ | Password for opencode server (HTTP basic auth) |
| `OPENAI_API_KEY` | _(none)_ | OpenAI API key (optional, use OAuth instead) |
| `ANTHROPIC_API_KEY` | _(none)_ | Anthropic API key (optional, use OAuth instead) |
| `OPENROUTER_API_KEY` | _(none)_ | OpenRouter API key |
| `GROQ_API_KEY` | _(none)_ | Groq API key |
| `DEEPSEEK_API_KEY` | _(none)_ | DeepSeek API key |
| `XAI_API_KEY` | _(none)_ | xAI (Grok) API key |

### Gateway Protection

Set `PROXY_API_KEY` to require authentication for all gateway requests:

```bash
# In .env
PROXY_API_KEY=my-secret-key
```

Clients must include the key in every request:
```bash
curl -H "Authorization: Bearer my-secret-key" http://localhost:3000/models
# OR
curl -H "X-Api-Key: my-secret-key" http://localhost:3000/models
```

The `/health` endpoint is always accessible without a key.

---

## How Model Caching Works

1. First call to `GET /models` fetches live data from opencode and caches it
2. Subsequent calls return cached data instantly
3. After 10 minutes (configurable via `CACHE_TTL`), the cache expires
4. Next request after expiry triggers a fresh fetch and re-caches
5. Use `GET /models?refresh=true` to force an immediate refresh

This means models are never stale for more than 10 minutes, and most requests are instant.

---

## Docker Volumes

| Volume | Purpose |
|--------|---------|
| `opencode-share` | Auth tokens, session data, credentials (`~/.local/share/opencode/`) |
| `opencode-config` | opencode configuration (`~/.config/opencode/`) |

These volumes persist across `docker compose down` / `docker compose up` and across Dokploy redeploys. Your auth tokens are safe.

To completely reset auth:
```bash
docker compose down -v  # removes volumes too
docker compose up -d --build
```

---

## Troubleshooting

### Gateway says "opencode not healthy"

```bash
# Check opencode logs
docker compose logs opencode

# Check if opencode is running
docker compose exec opencode curl http://localhost:4096/global/health
```

### Models endpoint returns empty

Make sure at least one provider is authenticated:
```bash
curl http://localhost:3000/auth/status
```

If no providers are connected, authenticate one (see [Authentication](#authentication)).

### Request timeout

The default timeout is 10 minutes. For very long queries, increase it:
```bash
# In .env
SERVER_TIMEOUT=1200000  # 20 minutes
```

Then restart: `docker compose up -d`

### OAuth flow not working

Some OAuth flows (ChatGPT Plus, Claude Pro) require browser access. If your server is remote:
1. Use SSH port forwarding: `ssh -L 3000:localhost:3000 your-server`
2. Access `http://localhost:3000/auth/openai/oauth/start` from your local machine
3. Complete the browser auth flow
4. The token is saved on the server

### Viewing opencode logs

```bash
docker compose logs -f opencode
docker compose logs -f gateway
```

---

## License

MIT
