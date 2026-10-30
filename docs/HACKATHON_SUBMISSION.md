# Nebius x NVIDIA Global AI Hackathon — Submission Pack

## Project title
AAPDA SETU — Urban Disaster Intelligence & Response

## Track
Best Apps and Agents

## One-line pitch
An evidence-driven urban disaster decision-support platform that fuses live environmental observations, deterministic hazard assessment, verified citizen reports, geospatial response coordination, and NVIDIA Nemotron reasoning—with humans retaining operational authority.

## Short description
Urban emergencies fragment critical information across weather feeds, citizen reports, maps, shelters, and response teams. AAPDA SETU unifies these signals into a source-aware operational picture. Its deterministic risk engine evaluates real forecast inputs across multiple horizons; citizens can submit geotagged incidents; authorized responders verify reports, coordinate resources, and track incident state. An NVIDIA Nemotron 3 Super assistant served through Nebius Token Factory explains the supplied context and offers bounded safety guidance without inventing observations or overriding deterministic risk results.

## What makes it technically substantive
- Deterministic, testable risk evaluation remains separate from generative AI.
- Source freshness is explicit: live, stale, unavailable, and offline are distinct states.
- Citizen reports move through a role-controlled verification and response lifecycle.
- Duplicate reports are clustered spatially and temporally without deleting original evidence.
- Resource recommendations are deterministic and human-approved.
- The Nemotron inference path runs server-side through Nebius Token Factory, with bounded inputs, provider provenance, timeout/failure handling, and explicit safety constraints.
- Supabase Auth and row-level security protect operational data and private evidence.

## NVIDIA / Nebius usage
- NVIDIA model: `nvidia/nemotron-3-super-120b-a12b` (Nemotron 3 Super).
- Inference platform: Nebius Token Factory OpenAI-compatible chat-completions API.
- Runtime integration: authenticated Supabase Edge Function `ai-chat`; Token Factory credentials are server-side only.
- Successful responses expose provider/model/request ID/latency/token usage as provenance.
- The model is used for contextual explanation and safety-oriented language assistance—not for fabricating measurements or making authoritative emergency decisions.

**Runtime verification required before submission:** Configure `NEBIUS_API_KEY` in Supabase Edge Function secrets, deploy `ai-chat`, and perform a successful live inference. Do not claim the model is live until this has been observed.

## Demo URL
https://aapda-setu-ten.vercel.app/

## Source repository
https://github.com/Themeta-verse/AAPDA_SETU

## Three-minute video storyboard
Target length: 2:40–2:55. Record the real running application and actual model response. Do not use mock overlays to imply live integrations.

| Time | Screen / narration |
|---|---|
| 0:00–0:15 | Open AAPDA SETU. State the problem: emergency information is fragmented across environmental feeds, citizens, and responders. |
| 0:15–0:40 | Show monitoring sources and freshness states. Point out that unavailable data is shown as unavailable—not silently treated as safe. |
| 0:40–1:05 | Open deterministic risk assessment. Show the horizon view and contributing inputs. Explain that the risk verdict is rule-based and reproducible. |
| 1:05–1:30 | Submit a citizen incident report, then show the responder incident queue and verification lifecycle. Use a clearly marked test account / scenario. |
| 1:30–1:55 | Show the geospatial map and resource command center. Explain that recommendations require authorized human action. |
| 1:55–2:25 | Ask the AI assistant a question about the displayed context. Show the real Nemotron response and its Nebius/model provenance. |
| 2:25–2:45 | Close with the architecture: source adapters → deterministic assessment → incident verification → response coordination → Nemotron advisory layer. Reiterate that official authorities retain decision authority. |

## Submission checklist
- [ ] Public repository and MIT license visible on GitHub.
- [ ] README contains clean setup and deployment instructions.
- [ ] Working demo URL verified in a clean browser session.
- [ ] `NEBIUS_API_KEY` configured as a Supabase server-side secret.
- [ ] Supabase `ai-chat` function deployed.
- [ ] At least one successful live Nemotron inference captured.
- [ ] CI build and test workflow passes.
- [ ] Public YouTube video under three minutes.
- [ ] Devpost entry submitted before the deadline.
- [ ] Team member names and required acknowledgements entered accurately.

## Prior-work disclosure
The AAPDA SETU repository was created on 30 September 2026 and builds on the team's earlier BayWatch prototype. The hackathon-specific engineering adds a Nebius Token Factory runtime path for NVIDIA Nemotron 3 Super, server-side key isolation, bounded and validated model context, response provenance, explicit provider-failure behavior, and disaster-domain safety constraints. The pre-existing deterministic risk, geospatial, incident, and responder workflows remain separately implemented and testable.
