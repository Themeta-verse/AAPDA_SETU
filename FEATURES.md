# BayWatch Features

## Product Objective

BayWatch is a predictive, geospatial, evidence-driven disaster-management and evacuation platform that connects citizens, emergency contacts, responders, shelters, and resources through a continuously updated risk and response system, with offline continuity when connectivity becomes unreliable.

Core pipeline:

PREDICT
→ VERIFY
→ RESPOND
→ PROTECT

## Development Principles

* No fake data.
* No random fallback data presented as real.
* No disconnected buttons.
* No fake AI.
* No fake real-time claims.
* Every displayed live value must have a source, timestamp, or clearly marked simulation state.
* Sensitive credentials must remain server-side.
* User location must be handled with explicit privacy controls.
* Emergency-contact information must be protected.
* SMS must use a real provider in production.
* Existing working features should be preserved.
* New functionality must integrate with the existing architecture.

## Current Feature Roadmap

### A. Data and intelligence layer

| Feature | Status | Notes |
|---------|--------|-------|
| Open-Meteo weather/marine integration | Implemented | Live data with "UNAVAILABLE" state when no fresh data |
| USGS earthquake feed | Implemented | Real-time earthquake detection |
| IMD (India Meteorological Dept) integration | Planned | Official weather source for India |
| INCOIS tsunami/coastal data | Planned | Official tsunami early warning |
| BMC/MCGM municipal data | Planned | Local flood/rain gauge data |
| NDMA/SACHET alerts | Planned | National disaster alerts |
| OSRM routing | Planned | Evacuation route calculation |

### B. Flood-risk modelling

| Feature | Status | Notes |
|---------|--------|-------|
| Deterministic Forecast-Based Risk Assessment | **Implemented** | Model `deterministic-flood-v1`: pure deterministic rules answering WHERE, HOW severe, WHY, WHAT happens next, WHAT sources support this. Multi-horizon: NOW, +1H, +3H, +6H, +24H. Distinguishes INSUFFICIENT_DATA vs NOT_APPLICABLE. |
| Heuristic risk engine (tide/wind/rain) | Implemented | Risk levels: safe/moderate/high/critical |
| Tsunami risk detection | Implemented | Via USGS + heuristic thresholds |
| Coastal flood prediction | Implemented | Rain probability + tide level based |
| Storm surge modelling | Planned | Requires INCOIS data |
| Urban drainage modelling | Later phase | Requires BMC infrastructure data |
| ML-based risk prediction | Later phase | Requires historical training data |

### C. Geospatial map

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-layer spatial intelligence | **Implemented** | EvacuationMap supports Risk Zones, Verified Incidents, Resources, Safe Shelters, GPS Location layers. Shows explicit `GEOGRAPHIC RISK DATA UNAVAILABLE` when data is absent. |
| Dynamic Urban Location Model | **Implemented** | City → Ward → Risk Zone structure replaces universal Juhu assumption. |
| Safe zone markers | Implemented | Database / urban context driven with operational/standby status |
| User location tracking | Implemented | useGeolocation hook with watchPosition |
| Distance/risk status display | Implemented | LocationTracker component |
| Evacuation direction calculation | Implemented | Bearing toward inland safe zones |
| Offline map tiles | Later phase | Requires tile caching strategy |

### D. Incident verification & operational lifecycle

| Feature | Status | Notes |
|---------|--------|-------|
| Citizen incident reporting | Implemented | CitizenReporting component + incident_reports table |
| Citizen report lifecycle tracking | **Implemented** | Citizen tracks reference ID and current status (Pending / Verified / Dispatched / Resolved) without operational controls |
| Photo upload with Supabase Storage | Implemented | incident-photos bucket with RLS and signed URLs |
| Responder verification workflow | **Implemented** | Queue, evidence inspection, verify/reject/resolve with notes and actor tracking |
| Duplicate clustering | **Implemented** | Spatial (500m) + temporal (2h) clustering preserving all original reports |
| Tactical demand classification | **Implemented** | Derived deterministically from verified incident types and evidence |
| Incident operational audit trail | **Implemented** | `incident_audit_logs` tracking state transitions, actors, and notes |

### E. Evacuation and routing

| Feature | Status | Notes |
|---------|--------|-------|
| Static evacuation routes (Juhu) | Implemented | Hardcoded in AI chat context |
| Dynamic routing (OSRM) | Planned | Requires OSRM integration |
| Multi-modal routing (walk/vehicle) | Later phase | |
| Shelter capacity tracking | Planned | Requires shelter database |
| Real-time route obstruction reports | Later phase | Crowdsourced + official |

### F. Resource allocation

| Feature | Status | Notes |
|---------|--------|-------|
| Resource inventory management | **Implemented** | Normalized `resources` table with operational status, capacities, and geographic links |
| Responder Resource Command Center | **Implemented** | Summary KPIs, inventory filtering, active demand overview, and audit log |
| Deterministic recommendation engine | **Implemented** | Rule-based compatible resource recommendations with human approval workflow |
| State-driven resource allocation | **Implemented** | Atomic capacity decrement, status updates, and audit trail via `resource_allocations` |
| Supply tracking | Later phase | |
| Volunteer coordination | Later phase | |

### G. Alerts and notifications

| Feature | Status | Notes |
|---------|--------|-------|
| In-app emergency banner | Implemented | EmergencyBroadcastBanner |
| Mobile emergency alert | Implemented | MobileEmergencyAlert |
| Voice guidance (browser TTS + ElevenLabs) | Implemented | VoiceAlertGuide + Edge Function |
| **G3 — SMS to user and emergency contacts** | **Implemented** | **Foundation complete** |
| Push notifications (PWA) | Planned | Service worker + VAPID |
| Email notifications | Planned | |
| Siren/broadcast integration | Later phase | Hardware integration |

#### G3 — SMS to user and emergency contacts (Detailed)

**Status: Implemented (Foundation)**

**Implemented behavior:**

User enters or is detected near a configured flood-risk zone.

The system evaluates:
* user's current location (via browser GPS with explicit permission)
* risk-zone geometry (configurable `risk_zones` table with center/radius/threshold)
* distance to the risk zone (Haversine formula)
* current risk severity (from live monitoring data: tide/wind/rain/tsunami)
* whether an alert has already been sent for this event (server-side deduplication via `should_send_alert` RPC + client cooldown)

If the configured threshold is reached and the risk severity qualifies:

```
USER
↓
LOCATION / GEOFENCE
↓
RISK ZONE CHECK
↓
SEVERITY CHECK
↓
ALERT DECISION
↓
SMS SERVICE (Supabase Edge Function)
├── USER (profile phone)
└── EMERGENCY CONTACTS (user-defined contacts table)
```

The SMS contains relevant emergency information:
* event type (flood, high_tide, tsunami, storm)
* severity (moderate, high, critical)
* timestamp (IST)
* relevant location (user's GPS coordinates)
* safety instruction (event-specific)
* nearest safe zone/shelter (JVPD Ground, Mithibai College, Cooper Hospital, Juhu Police Station)
* emergency numbers (112, 108, 100)

The system avoids repeated SMS spam via:
* **Server-side**: `should_send_alert` RPC with 60-minute cooldown per user/zone/event/severity
* **Client-side**: Local cooldown map in `useSMSAlert` hook (same key)
* **Event escalation**: New alert triggered only on severity increase or new event type

SMS provider credentials **NEVER exposed in frontend code** — stored as Supabase Edge Function secrets (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`).

Production SMS uses Twilio (real provider).

Development/test mode: **Clearly distinguishable** — without Twilio credentials, Edge Function logs message and returns `test_mode` status; no fake success returned.

**Test Mode (Development):**
* **TEST SMS button** in top bar (only in development, `import.meta.env.DEV`)
* Triggers full pipeline: JWT auth → user lookup → emergency contacts → risk zone validation → Haversine geofence → deduplication → Edge Function
* Edge Function returns `test_mode: true`, logs message, does NOT call Twilio
* UI shows "TEST MODE" badge on toast notification
* `sms_alert_log` records the test with `status: 'test_mode'` per recipient

### H. User and family safety

| Feature | Status | Notes |
|---------|--------|-------|
| User profile (name, phone) | Implemented | profiles table |
| User-defined emergency contacts | Implemented | emergency_contacts table with RLS |
| Family circle / group safety | Later phase | |
| Location sharing with trusted contacts | Later phase | |
| Check-in / safe status | Later phase | |

### I. Voice guidance and drills

| Feature | Status | Notes |
|---------|--------|-------|
| Browser TTS voice alerts | Implemented | VoiceAlertGuide |
| ElevenLabs premium TTS | Implemented | Edge Function with API key |
| Multilingual voice (en/hi/mr/gu) | Implemented | |
| Mock drill mode | Implemented | MockDrill component |
| Scenario simulation | Implemented | ScenarioSimulation component |

### J. Responder and control-room dashboard

| Feature | Status | Notes |
|---------|--------|-------|
| Responder role in profiles | Implemented | role field: citizen/responder/admin |
| Responder RLS policies | Implemented | Can read operational reports |
| Control room UI | Not implemented | |
| Incident triage queue | Not implemented | |
| Resource deployment UI | Not implemented | |

### K. Offline and reliability

| Feature | Status | Notes |
|---------|--------|-------|
| Network status detection | **Implemented** | `useNetworkStatus` hook with online/offline/reconnecting states |
| Monitoring data cache | **Implemented** | localStorage-based cache with timestamps, auto-save on live data, fallback to cache when offline |
| Stale data indicator | **Implemented** | Shows "STALE" / "OFFLINE" source status with last update timestamp |
| Connection status UI | **Implemented** | Top bar indicator: ONLINE / RECONNECTING / OFFLINE with icons |
| GPS offline continuity | **Implemented** | Browser geolocation continues working without internet |
| Emergency info offline | **Implemented** | Cached risk zones, alerts, monitoring data remain accessible |
| SMS offline behavior | **Implemented** | SMS only triggers when online; deduplication preserved across reconnection |
| PWA manifest | **Implemented** | Auto-generated by vite-plugin-pwa with standalone display mode |
| Service worker caching | **Implemented** | App shell caching via vite-plugin-pwa (Workbox), static assets only |
| Offline incident queue | **Implemented** | IndexedDB-based queue with background sync on reconnection |
| Background sync | **Implemented** | Automatic retry on reconnection with exponential backoff, max 3 retries |
| Bluetooth mesh messaging | Later phase | |
| Satellite messaging fallback | Later phase | |

### L. Existing features (implemented)

- Real-time monitoring dashboard with live weather/marine data
- Earthquake detection via USGS
- Citizen incident reporting with photo submission
- Multilingual support (English, Hindi, Marathi, Gujarati)
- Emergency voice alerts via browser TTS and ElevenLabs
- Scenario simulation for disaster preparedness training
- Evacuation map with safe zone information
- Government guidelines following NDMA recommendations
- Tourist safety mode with simplified instructions
- AI chatbot with monitoring data context
- Alert logging (alert_logs table)
- User authentication with Supabase Auth
- Row Level Security on all tables
- **SMS emergency alerts to user and emergency contacts (Twilio, server-side, deduplicated)**
- **Configurable risk zones with geofence-based triggering**
- **Emergency contacts management (database + RLS)**
- **Network status detection (online/offline/reconnecting)**
- **Monitoring data cache with stale/offline fallback**
- **Connection status indicator in top bar**
- **GPS location tracking continues offline**
- **PWA app shell with service worker caching**
- **Offline incident report queue with IndexedDB and background sync**
- **Connection status and queue indicator in top bar**

### M. Later mobile phase

- Native mobile app (React Native / Capacitor)
- Background location tracking
- Push notifications
- Offline-first architecture
- Bluetooth mesh for peer-to-peer alerts
- Satellite SOS integration