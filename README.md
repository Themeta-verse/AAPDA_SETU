# AAPDA SETU
## Urban Disaster Intelligence & Emergency Response Platform

**AAPDA SETU** is a geospatial, evidence-driven disaster decision-support platform for citizens and emergency-response teams. It combines live environmental observations, deterministic multi-horizon risk assessment, verified citizen reports, responder workflows, resource coordination, and an AI advisory assistant powered by **NVIDIA Nemotron 3 Super on Nebius Token Factory**.

> **Safety boundary:** AAPDA SETU is a research/prototype decision-support system, not a certified early-warning authority. It does not issue authoritative evacuation orders. Follow official local authority instructions. In India, call **112** for emergency response or **108** for ambulance services.

**Live demo:** https://aapda-setu-ten.vercel.app/  
**Source:** https://github.com/Themeta-verse/AAPDA_SETU

---

## Why it exists

Urban emergencies are fragmented across weather feeds, marine observations, citizen reports, maps, shelters, and response teams. AAPDA SETU brings those signals into one operational picture while preserving the difference between an observed fact, a deterministic assessment, an AI-generated explanation, and an unknown.

Its core operating loop is:

**OBSERVE → ASSESS → VERIFY → COORDINATE → INFORM**

## What is implemented

### Environmental and geospatial intelligence
- Open-Meteo forecast and marine observations with source freshness states.
- USGS earthquake feed and tsunami signal integration.
- Deterministic risk assessment with explicit contributing inputs and forecast horizons (NOW, +1h, +3h, +6h, +24h).
- Separate `LIVE`, `STALE`, `UNAVAILABLE`, and `OFFLINE` states; missing measurements are never silently converted to zero or safe.
- City → ward → risk-zone context and layered maps for risk zones, verified incidents, resources, shelters, and user location.

### Citizen-to-responder incident workflow
- Citizen incident reporting with optional photo evidence.
- Offline incident queue for connectivity interruptions.
- Responder verification, rejection, dispatch, and resolution workflow.
- Spatial/temporal duplicate clustering while preserving original reports.
- Incident lifecycle audit records and role-scoped operational access.

### Response coordination
- Resource inventory and responder command center.
- Deterministic resource compatibility recommendations with human approval.
- Transactional allocation and capacity updates with audit history.
- Evacuation guidance and safe-zone context.
- Multilingual citizen guidance (English, Hindi, Marathi, Gujarati).
- Browser voice guidance and optional ElevenLabs text-to-speech integration.
- Emergency SMS workflow foundation through a server-side Supabase Edge Function; real delivery requires Twilio credentials. Test mode is explicitly identified and is not represented as delivered SMS.

### NVIDIA Nemotron advisory assistant
The assistant's inference path is:

`Browser Chat → Supabase Authenticated Edge Function → Nebius Token Factory → NVIDIA Nemotron 3 Super → Response + Provider Provenance`

- Model: `nvidia/nemotron-3-super-120b-a12b`
- Provider API: Nebius Token Factory (OpenAI-compatible chat completions).
- API key is held only as a Supabase Edge Function secret; it is never exposed to the browser.
- Bounded request size and conversation history.
- Monitoring values are range-checked and source freshness is preserved.
- The model cannot override deterministic risk classifications, invent observations, claim shelter/route availability, or issue authoritative evacuation orders.
- Provider failures return an explicit unavailable response and conservative emergency guidance.
- Successful responses include provider, model, request ID, latency, and token-usage provenance.

See [NVIDIA Nemotron + Nebius integration guide](docs/NEBIUS_NEMOTRON_INTEGRATION.md).

## Architecture

| Layer | Technology |
|---|---|
| Web client | React 18, TypeScript, Vite |
| UI | Tailwind CSS, shadcn/ui, Radix UI, Framer Motion |
| State/data | TanStack Query |
| Maps | Leaflet / OpenStreetMap |
| Charts | Recharts |
| Backend | Supabase PostgreSQL, Auth, Storage, Edge Functions |
| Risk engine | Deterministic TypeScript rules with provenance and forecast horizons |
| AI inference | NVIDIA Nemotron 3 Super via Nebius Token Factory |
| Voice | Browser SpeechSynthesis; optional ElevenLabs TTS |
| Testing | Vitest, Testing Library |

### Repository map

```
src/
  components/       Citizen, responder, map, dashboard and command-center UI
  hooks/            Auth, monitoring, location, incidents, resources, offline queue
  integrations/     External data adapters and Supabase data access
  lib/              Deterministic flood intelligence, geospatial and domain logic
  risk/             Canonical risk engine and explainability
  voice/            Multilingual voice and alert handling
  notifications/    Notification engine
supabase/
  functions/        Authenticated AI, official-warning, SMS and TTS functions
  migrations/       Database schema, RLS and operational workflow migrations
docs/
  NEBIUS_NEMOTRON_INTEGRATION.md
```

## Run locally

### Requirements
- Node.js 20+
- npm 10+ (or a compatible package manager)
- A Supabase project for authenticated and operational workflows

### Install and start

```bash
git clone https://github.com/Themeta-verse/AAPDA_SETU.git
cd AAPDA_SETU
npm ci
cp .env.example .env
npm run dev
```

Set the following browser-safe values in `.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Apply the SQL migrations in `supabase/migrations/` to the linked Supabase project. Configure Supabase Auth, the private incident-photo storage bucket, and operational roles according to the migration policies and project setup.

### Configure NVIDIA Nemotron on Nebius

1. Create a Nebius Token Factory API key.
2. Add `NEBIUS_API_KEY` in Supabase Dashboard → Edge Functions → Secrets.
3. Deploy the authenticated AI function:

```bash
supabase login
supabase link --project-ref YOUR_SUPABASE_PROJECT_REF
supabase secrets set NEBIUS_API_KEY=YOUR_TOKEN_FACTORY_KEY
supabase functions deploy ai-chat
```

**Never** put the Token Factory key in `.env`, a `VITE_*` variable, frontend code, or Git. The key must remain a server-side secret.

### Optional integrations

- **ElevenLabs:** configure the relevant Supabase Edge Function secrets to enable hosted voice generation; browser speech remains the fallback.
- **Twilio:** configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` as Supabase Edge Function secrets for real SMS delivery. Without these, the function must remain clearly in test mode.

## Quality checks

```bash
npm run build
npm run test
npm run lint
```

The project includes deterministic risk-engine tests, source-adapter tests, security-policy tests, incident workflow tests, resource workflow tests, offline queue tests, and UI tests. Run the checks in the same environment used for release and report the actual results; a README badge is not a substitute for a test run.

## Data integrity and safety principles

1. **No fabricated live data.** Every operational measurement must retain source/freshness context.
2. **Unknown is not safe.** Missing, stale, or offline inputs must remain visible as such.
3. **Deterministic risk owns the verdict.** The language model explains context; it does not calculate or override official risk classifications.
4. **Human authority is preserved.** Resource allocation and incident lifecycle actions are controlled by authorized responders.
5. **Least privilege.** Supabase Auth, row-level security, storage policies, and server-side secret handling protect operational data.
6. **Fail visibly.** Provider or data-source failures are reported as unavailable rather than masked as success.
7. **Privacy by design.** Do not collect or expose personal location or incident evidence beyond what the workflow requires.

## Hackathon development note

AAPDA SETU was created during the Nebius x NVIDIA Global AI Hackathon submission period. The AAPDA SETU repository was created on 30 September 2026 and builds on the team's earlier BayWatch prototype. The hackathon-specific engineering adds an NVIDIA Nemotron inference path through Nebius Token Factory, server-side credential isolation, bounded and validated context, explicit model provenance, failure handling, and disaster-domain safety constraints. The base environmental, geospatial, incident, and response workflows remain independently implemented in the repository. See [the submission pack](docs/HACKATHON_SUBMISSION.md) for the prior-work disclosure and demo storyboard.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

- NVIDIA Nemotron open models
- Nebius Token Factory
- Open-Meteo
- USGS Earthquake Hazards Program
- Supabase
- OpenStreetMap contributors
