# NVIDIA Nemotron on Nebius Token Factory

AAPDA SETU uses NVIDIA Nemotron 3 Super through the Nebius Token Factory OpenAI-compatible chat-completions API for its advisory disaster-response assistant.

## Runtime path

`Chatbot (browser) → authenticated Supabase Edge Function (ai-chat) → Nebius Token Factory → NVIDIA Nemotron 3 Super → bounded response + provider provenance`

The provider key is server-side only. It is never prefixed with `VITE_`, embedded in the browser bundle, returned in an API response, or committed to Git.

## Configure the provider

1. Create a Token Factory API key in the Nebius console.
2. In the Supabase project linked to this deployment, open Edge Functions → Secrets.
3. Add `NEBIUS_API_KEY` with the Token Factory key value.
4. Deploy the `ai-chat` Edge Function from this repository.
5. Sign in to AAPDA SETU and send a question through the assistant.
6. Inspect the function logs and response `provenance` object. A successful response identifies provider, model, request ID, latency, and token usage.

CLI alternative (requires a configured Supabase CLI project):

```bash
supabase secrets set NEBIUS_API_KEY=YOUR_TOKEN_FACTORY_KEY
supabase functions deploy ai-chat
```

Never paste the key into source code, browser environment variables, screenshots, or chat messages. Rotate it immediately if exposed.

## Model and endpoint

- Provider: Nebius Token Factory
- API: `https://api.tokenfactory.nebius.com/v1/chat/completions`
- Model: `nvidia/nemotron-3-super-120b-a12b`
- Protocol: OpenAI-compatible chat completions

Model ID and request pattern follow the Nebius Token Factory cookbook: https://github.com/nebius/token-factory-cookbook/tree/main/models/nemotron

## Safety and reliability controls

- Supabase gateway JWT verification remains enabled for `ai-chat`.
- The function independently requires a bearer token.
- Request bodies and conversation history are bounded.
- Monitoring fields are type/range checked and freshness is preserved.
- Missing or stale observations are never converted to safe values.
- The model is explicitly prohibited from issuing authoritative evacuation orders, inventing shelter/route availability, or overriding deterministic risk results.
- Provider failures return an explicit unavailable response with emergency fallback guidance; they are not represented as successful AI responses.
- Provider response bodies and credentials are not logged.

## Verification record

The repository integration is implemented as source code. Runtime activation is only verified after `NEBIUS_API_KEY` is configured, the Edge Function is deployed, and a successful inference request is observed. Do not claim live Nemotron availability before that check.

## Operational boundary

AAPDA SETU is a research/prototype decision-support system, not a certified early-warning authority. The deterministic risk engine remains the source of risk classifications. Human responders and official agencies retain all operational authority.
