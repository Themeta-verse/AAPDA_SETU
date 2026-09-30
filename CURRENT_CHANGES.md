# Current Changes

## Project Baseline

* Repository: Themeta-verse/AAPDA_SETU
* Application: BayWatch
* Stack: React + TypeScript + Vite + Supabase
* Current workstream: SMS emergency alert feature
* Development model: Parallel development with another developer
* Rule: Avoid unrelated file changes and merge conflicts.

## Current Status

SMS feature:
**IMPLEMENTED - Foundation Complete**

Environment:
Supabase configuration required for full application. Edge Function secrets needed: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.

## Change Log

### 2026-09-30 — Project Memory Initialization

* **Files created**: FEATURES.md, CURRENT_CHANGES.md
* **What changed**: Created project memory files to track feature specifications and implementation history for parallel development sessions.
* **Why**: Required by development rules for session continuity and model switching.
* **Validation**: Files created and populated with current project state.
* **Known limitations**: None.
* **Developer awareness**: Other developer should reference FEATURES.md for feature status and roadmap.

---

### 2026-09-30 — SMS Emergency Alert Foundation Implementation

#### Database Migration: `supabase/migrations/20260930120000_sms_emergency_alerts.sql`

* **Tables created**:
  - `emergency_contacts` — User-defined emergency contacts (name, phone, relationship, is_primary) with RLS policies enforcing user ownership
  - `risk_zones` — Configurable geofences (center lat/lon, radius, alert threshold, severity threshold, event types) with default Juhu Beach zone
  - `sms_alert_log` — Deduplication tracking (user_id, zone_id, event_type, severity, recipients, message, provider_response, status)
* **Functions created**:
  - `should_send_alert(p_user_id, p_zone_id, p_event_type, p_severity, p_cooldown_minutes)` — Returns boolean for deduplication (default 60-min cooldown per user/zone/event/severity)
* **Indexes**: `idx_sms_alert_log_user_zone_severity` for efficient deduplication queries
* **RLS**: All tables have appropriate policies; `risk_zones` readable by all authenticated users for client-side geofence checks

#### Edge Function: `supabase/functions/send-emergency-sms/index.ts`

* **Architecture**: Server-side only; JWT verified via `verify_jwt = true` in config.toml
* **SMS Provider**: Twilio (abstraction allows swap); credentials via `Deno.env.get()` — never in frontend
* **Test Mode**: If Twilio credentials not configured, logs message and returns `test_mode` status — no fake success
* **Recipients**: Authenticated user's profile phone + all their emergency contacts
* **Message Content**: Event type, severity, timestamp, user location, risk data (tide/wind/rain), safety instructions per event type, nearest safe zone, emergency numbers
* **Deduplication**: Calls `should_send_alert` RPC before sending; skips if recent alert exists
* **Logging**: Inserts to `sms_alert_log` with full recipient results and provider responses
* **Security**: Service role key used for DB writes; user ownership verified via JWT

#### Frontend Hook: `src/hooks/useSMSAlert.ts`

* **Integration**: Subscribes to `useAuth`, `useGeolocation`, `useMonitoring`
* **Geofence Logic**: For each active risk zone matching current event type:
  - Calculates Haversine distance from user position to zone center
  - Triggers if `distance <= zone.alert_threshold_km` AND `current_risk >= zone.severity_threshold`
* **Event Type Mapping**: Maps monitoring alert types (highTide→high_tide, tsunami→tsunami, flood→flood, storm→storm)
* **Deduplication**: Local 60-min cooldown map (keyed by user/zone/event/severity) + server-side RPC check
* **State**: `isMonitoring`, `lastAlertSent`, `lastAlertEvent`, `error`, `riskZones`
* **Exports**: `testSMSAlert(zoneId?)` for manual testing, `clearError()`, `refetchZones()`

#### TypeScript Types: `src/integrations/supabase/types.ts`

* Added `emergency_contacts`, `risk_zones`, `sms_alert_log` table types
* Added `should_send_alert` function type

#### UI Integration: `src/pages/Index.tsx`

* Added `useSMSAlert` hook
* Top-bar indicator: "SMS ALERT ON/OFF" with pulsing bell icon when monitoring active
* Toast notification: Shows last sent alert (with timestamp/event) or error; dismissible

#### Config: `supabase/config.toml`

* Added `[functions.send-emergency-sms]` with `verify_jwt = true`

#### Validation Performed

* `npm run build` — **PASS** (production build successful)
* `npm run test` — **PASS** (existing tests pass)
* `npm run lint` — Pre-existing errors only (no new errors from SMS code)
* TypeScript compilation — **PASS** (no type errors in new code)

#### Known Limitations

1. **Twilio credentials required for production SMS** — Without `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` in Supabase Edge Function secrets, function runs in test mode (logs only)
2. **Single risk zone (Juhu Beach) configured by default** — Additional zones require admin insert via SQL or future admin UI
3. **Client-side geofence check** — Relies on browser GPS; accuracy depends on device/permissions
4. **60-minute cooldown hardcoded in hook + RPC** — Configurable via RPC parameter but not yet exposed in UI
5. **No emergency contacts UI** — Contacts table exists but no management component yet (separate workstream)
6. **Event type mapping is heuristic** — Maps monitoring alert IDs to SMS event types; may need refinement
7. **No offline queue** — SMS requires connectivity; offline support is later phase

#### Files Another Developer Should Avoid Modifying

* `supabase/migrations/20260930120000_sms_emergency_alerts.sql` — Schema changes require new migration
* `supabase/functions/send-emergency-sms/index.ts` — Server-side SMS logic; secrets here
* `src/hooks/useSMSAlert.ts` — Core alert triggering logic; changes affect deduplication behavior
* `src/integrations/supabase/types.ts` — Auto-generated; prefer regeneration over manual edits

#### Potential Merge Conflict Files

* `supabase/config.toml` — If other developer adds Edge Functions
* `src/pages/Index.tsx` — If other developer modifies top bar or component order
* `src/integrations/supabase/types.ts` — If other developer adds DB tables

---

### 2026-09-30 — Server-Side Risk Zone Validation Fix

#### Validation Gap Identified

The Edge Function `send-emergency-sms` was trusting frontend-provided parameters without independent server-side verification:
- `zone_id` — not verified to exist or be active
- `user_location` — not verified against zone geometry
- `event_type` — not verified against zone's configured `event_types`
- `severity` — not verified against zone's `severity_threshold`
- `risk_data` / `risk_level` — not independently validated (monitoring data not available server-side)

This allowed a malicious or buggy frontend to trigger SMS for any zone, any location, any event type, regardless of actual risk conditions.

#### Files Changed to Fix

* `supabase/functions/send-emergency-sms/index.ts` — Added server-side validation logic

#### Exact Server-Side Validations Added

After JWT authentication and basic parameter validation, before deduplication check:

1. **Fetch zone from database** using `zone_id`:
   ```typescript
   const { data: zone } = await supabase
     .from('risk_zones')
     .select('id, name, center_lat, center_lon, alert_threshold_km, severity_threshold, event_types, is_active')
     .eq('id', zone_id)
     .eq('is_active', true)
     .single();
   ```

2. **Zone existence & active status** — Returns 400 if zone not found or `is_active = false`

3. **Event type validation** — Returns 400 if `event_type` not in `zone.event_types` array

4. **Severity threshold validation** — Compares requested severity against `zone.severity_threshold` using order: moderate=1, high=2, critical=3. Returns 400 if request severity < zone threshold.

5. **Independent geofence calculation** — Uses Haversine formula (same as frontend) to calculate distance from `user_location` to `zone.center_lat/center_lon`. Returns 400 with details if `distance_km > zone.alert_threshold_km`.

6. **Only then proceeds** to deduplication check (`should_send_alert` RPC) and SMS sending.

#### Remaining Limitation: Independent Live-Risk Verification

The Edge Function **cannot independently verify the live BayWatch risk state** (tide level, wind speed, rain probability, tsunami risk, computed `risk_level`) because:

- The risk engine (`deriveMonitoringData`) runs client-side in `useMonitoring` hook using Open-Meteo/USGS data fetched via browser
- No server-side cron/job currently fetches and computes the same risk model
- The `risk_data` object in the request is still frontend-provided and trusted

**Mitigation**: The server now independently validates the *geofence* (zone config + user distance) and *zone policy* (event types, severity threshold). The live risk values are used only for message content, not for the send/no-send decision (which is now based on zone threshold + distance).

**Future work**: Deploy a server-side risk computation (Edge Function cron or separate worker) that mirrors `deriveMonitoringData` and stores current risk state in DB for Edge Function to query.

#### Validation Performed

* `npm run build` — **PASS**
* `npm run test` — **PASS**
* `npx tsc --noEmit` — **PASS**

*End of SMS milestone. Do not start another BayWatch feature automatically.*

---

### 2026-09-30 — Offline & Reliability Foundation

#### Files Created
* `src/lib/offlineCache.ts` — localStorage-based cache utility with timestamps, source tracking, and stale detection
* `src/hooks/useNetworkStatus.ts` — Network status hook detecting online/offline/reconnecting states via `navigator.onLine` events

#### Files Modified
* `src/hooks/useMonitoring.ts` — Added offline caching: saves live data to cache, loads from cache when offline, tracks sourceStatus (live/stale/offline/unavailable)
* `src/pages/Index.tsx` — Added `useNetworkStatus` hook, added connection status indicator in top bar (ONLINE/RECONNECTING/OFFLINE with icons)
* `FEATURES.md` — Updated Offline and reliability section (K) and Existing features (L) with implemented status
* `CURRENT_CHANGES.md` — This entry

#### Architecture
**Offline Data Strategy:**
- localStorage for persistent structured cache (no IndexedDB dependency)
- Cache keys: `baywatch_monitoring_data`, `baywatch_alerts`, `baywatch_risk_zones`, `baywatch_weather_data`, `baywatch_earthquake_data`
- Each cache entry: `{ data, updatedAt, source, status }`
- Max age: 10 minutes for staleness detection

**Network Detection:**
- `useNetworkStatus` hook listens to `window.online` / `window.offline` events
- Returns: `status` ('online' | 'offline' | 'reconnecting'), `isOnline`, `lastOnlineAt`, `lastOfflineAt`
- 1-second reconnecting grace period before showing ONLINE

**Monitoring Data Flow:**
- ONLINE + live data → compute → save to cache → set sourceStatus='live'
- ONLINE + no live data → set sourceStatus='unavailable'
- OFFLINE + cached data → load from cache → set sourceStatus='stale'
- OFFLINE + no cache → set sourceStatus='offline'

**UI Indicators:**
- Top bar: WiFi icon + ONLINE (green pulse) / RECONNECTING (yellow spin) / OFFLINE (gray)
- Monitoring dashboard sourceStatus: live / stale / unavailable / offline

**SMS Offline Behavior:**
- SMS alerts only trigger when `isOnline && riskData.isLive`
- Deduplication preserved: `should_send_alert` RPC + client cooldown survive reconnection
- No duplicate SMS on reconnection

#### Validation Performed
* `npm run build` — **PASS**
* `npm run test` — **PASS**
* `npx tsc --noEmit` — **PASS**

#### Known Limitations
1. **Cache max age 10 minutes** — Configurable but not exposed in UI
2. **No service worker** — App shell not cached for offline load; only data cached
3. **No PWA manifest** — Not installable as standalone app
4. **Weather/earthquake hooks not cached** — Only aggregated monitoring data cached; raw API responses not cached separately
5. **Map tiles not cached** — OpenStreetMap tiles require service worker for offline maps
6. **No background sync** — Offline incident reports not queued (later phase)

#### Files Another Developer Should Avoid Modifying
* `src/lib/offlineCache.ts` — Core cache utilities; changes affect all cached data
* `src/hooks/useNetworkStatus.ts` — Network detection logic
* `src/hooks/useMonitoring.ts` — Monitoring data flow with cache integration
* `src/pages/Index.tsx` — Top bar indicators (potential merge conflict area)

---

### 2026-09-30 — SMS Test Mode (Development Only)

#### Files Changed
* `src/hooks/useSMSAlert.ts` — Added `lastAlertTestMode` state, captures `test_mode` from Edge Function response
* `src/pages/Index.tsx` — Added "TEST SMS" button in top bar (development only), updated toast to show "TEST MODE" badge

#### Test Mode Behavior
1. **Button**: "TEST SMS" appears in top bar only when `import.meta.env.DEV === true` and user is authenticated with at least one risk zone configured
2. **Click Action**: Calls `testSMSAlert(zoneId)` → `sendSMSAlert(zone, 'flood', 'high')`
3. **Full Pipeline Executes**:
   - JWT authentication (Bearer token)
   - User profile + emergency contacts lookup
   - Risk zone fetch + validation (existence, active, event_type, severity_threshold)
   - Independent Haversine distance calculation (user_location → zone center)
   - Deduplication check via `should_send_alert` RPC
   - Edge Function processes all recipients
4. **Edge Function Test Mode** (no Twilio credentials):
   - `isTestMode = true` (missing `TWILIO_ACCOUNT_SID`/`AUTH_TOKEN`/`FROM_NUMBER`)
   - Logs `[TEST MODE] Would send SMS to +91XXXXXXXXXX (Name): <message>`
   - Returns per-recipient `status: 'test_mode'`, `message: 'SMS not sent - Twilio credentials not configured'`
   - Response includes `test_mode: true`
5. **UI Feedback**: Toast shows "SMS Alert Sent" with **"TEST MODE"** badge (primary-colored pill)
6. **Database Log**: `sms_alert_log` inserted with `status: 'sent'` (since test_mode counts as sent) and `recipients` array containing `test_mode` entries

#### Production SMS Requirement
**Twilio credentials must be configured in Supabase Edge Function secrets:**
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` (verified sender, E.164 format e.g., `+15551234567`)

Without these, all SMS deliveries remain in TEST MODE — no real SMS sent, no charges incurred.

#### Validation Performed
* `npm run build` — **PASS**
* `npm run test` — **PASS**
* `npx tsc --noEmit` — **PASS**

---

### 2026-09-30 — PWA / App Shell + Offline Incident Queue + Background Sync

#### Files Created
* `src/lib/offlineIncidentQueue.ts` — IndexedDB-based offline incident queue with full CRUD operations
* `src/hooks/useOfflineIncidentQueue.ts` — React hook for queue management with background sync on reconnection
* `vite.config.ts` (modified) — Added vite-plugin-pwa configuration for service worker and manifest

#### Files Modified
* `src/lib/offlineCache.ts` — (existing, unchanged)
* `src/hooks/useNetworkStatus.ts` — (existing, unchanged)
* `src/hooks/useMonitoring.ts` — (existing, unchanged)
* `src/hooks/useSMSAlert.ts` — (existing, unchanged)
* `src/components/CitizenReporting.tsx` — Integrated offline queue: queues incidents when offline, submits directly when online; added connection status + queue indicator in UI
* `src/pages/Index.tsx` — Added `useOfflineIncidentQueue` hook; added offline queue count indicator in top bar
* `vite.config.ts` — Added vite-plugin-pwa with app shell caching, manifest, and Workbox configuration
* `FEATURES.md` — Updated Offline and reliability (K) and Existing features (L) with PWA/queue status
* `CURRENT_CHANGES.md` — This entry

#### A. PWA / App Shell
* **vite-plugin-pwa** integrated with `autoUpdate` registration
* **App shell caching**: All static assets (JS, CSS, HTML, icons) precached via Workbox
* **Service worker**: Generated `sw.js` + `workbox-*.js` in dist; `registerType: autoUpdate`
* **Manifest**: Auto-generated with standalone display mode, BayWatch branding
* **Cache strategy**: CacheFirst for static assets and Google Fonts; NO API caching (no Supabase, no Open-Meteo, no USGS responses cached)
* **No private data cached**: Supabase auth tokens, Twilio credentials, emergency contacts, user data excluded from SW cache

#### B. Offline Incident Report Queue
* **IndexedDB schema** (`baywatch_offline` / `incident_queue`):
  - `localQueueId` (PK), `userId`, `type`, `description`, `photoBlob`, `photoName`, `latitude`, `longitude`, `createdAt`, `status` (queued/syncing/synced/failed/requires_action), `retryCount`, `lastError`, `timestamp`
  - Indexes on `status`, `userId`, `createdAt`
* **Queue behavior**:
  - ONLINE: Direct Supabase insert + photo upload to `incident-photos` bucket (existing behavior preserved)
  - OFFLINE: Validates locally, stores in IndexedDB with `status: 'queued'`, shows toast "Incident saved offline. Will upload when connection is restored."
  - Photo stored as Blob in IndexedDB; re-uploaded on sync
* **Queue UI**:
  - CitizenReporting: Connection status badge (ONLINE/OFFLINE/RECONNECTING) + queued count badge
  - Top bar (Index.tsx): Shows queued count when > 0
  - Toast messages clearly distinguish "saved offline" vs "submitted"

#### C. Background Sync / Reconnection
* **Trigger**: `useNetworkStatus` detects `online` event → `useOfflineIncidentQueue` processes queue
* **Sync logic**:
  1. Fetch all `queued` incidents for current user
  2. For each: mark `syncing`, upload photo (if any), insert to `incident_reports`
  3. On success: mark `synced`, show toast "Offline report synced successfully"
  4. On failure: mark `failed`, increment `retryCount`, store error
  5. Max 3 retries per incident; after max retries → `requires_action` (user must retry manually)
  6. After all processed: clear `synced` items from queue
* **Retry strategy**: 5s base delay, exponential backoff via sequential processing
* **Auth safety**: Only syncs incidents where `incident.userId === currentUser.id`; mismatched user incidents → `requires_action`
* **Logout handling**: Queued incidents remain in IndexedDB; if user logs out and different user logs in, old user's queue marked `requires_action` (never auto-sync under wrong account)

#### Photo Handling
* **OFFLINE**: Photo stored as Blob in IndexedDB (max ~50MB practical limit)
* **ONLINE sync**: Photo uploaded to Supabase Storage `incident-photos` bucket, public URL saved to `photo_url`
* **No fake success**: Photo not uploaded until sync completes; UI never shows "submitted" for queued reports

#### Authentication Safety
* Queue tied to `userId` from Supabase auth
* `requires_action` status prevents cross-account sync
* No auth tokens stored in IndexedDB

#### Database / RLS
* Uses existing `incident_reports` table and `incident-photos` bucket
* Server-side RLS remains authoritative (user can only insert own reports)
* Offline queue never bypasses RLS — sync uses authenticated Supabase client

#### Validation Performed
* `npm run build` — **PASS** (PWA assets generated: sw.js, workbox-*.js, manifest.webmanifest)
* `npm run test` — **PASS**
* `npx tsc --noEmit` — **PASS**

#### Known Limitations
1. **Photo Blob size** — Large photos may hit IndexedDB storage quota (~50MB practical); no compression applied
2. **No service worker background sync API** — Sync runs on page load/reconnection event, not SW background sync (not widely supported)
3. **Max 3 retries** — Hardcoded; not configurable
4. **No offline map tiles** — OpenStreetMap requires separate tile caching strategy
5. **Queue not shared across tabs** — IndexedDB is per-origin; no BroadcastChannel sync between tabs
6. **No queue UI for non-CitizenReporting pages** — Top bar shows count only; detailed view only in CitizenReporting

#### Files Another Developer Should Avoid Modifying
* `src/lib/offlineIncidentQueue.ts` — Core IndexedDB queue logic
* `src/hooks/useOfflineIncidentQueue.ts` — Queue management + background sync
* `src/components/CitizenReporting.tsx` — Offline queue integration point
* `src/pages/Index.tsx` — Top bar queue indicator (potential merge conflict)
* `vite.config.ts` — PWA configuration

#### Potential Merge Conflict Files
* `src/pages/Index.tsx` — Top bar modifications
* `vite.config.ts` — If other developer modifies Vite config
* `src/components/CitizenReporting.tsx` — If other developer modifies incident reporting

---

### 2026-10-01 — Resource Command Center & Resource Management

#### Files Created
* `supabase/migrations/20261001120000_resource_command_center.sql` — Schema migration for resources, allocations, audit logs, and compatibility matrix
* `src/integrations/supabase/resources.ts` — Typed data access layer with normalization, offline guards, and deterministic rule-based recommendation engine
* `src/hooks/useResources.ts` — React hooks (`useResources`, `useResourceAllocations`, `useResourceAuditLogs`, `useResourceCompatibility`, `useResourceMutations`)
* `src/components/ResourceCommandCenter.tsx` — Complete operational command center UI with multilingual support, KPIs, inventory filters, and approval workflows
* `src/integrations/supabase/resources.test.ts` — Unit & integration tests for all 13 core requirements and migration static assertions
* `src/components/ResourceCommandCenter.test.tsx` — RTL component behavioral tests for role gating, KPIs, recommendations, and offline notice

#### Files Modified
* `src/integrations/supabase/types.ts` — Added database types for `resources`, `resource_allocations`, `resource_audit_logs`, `resource_incident_compatibility` and associated enums
* `src/lib/offlineCache.ts` — Added `RESOURCES` and `ALLOCATIONS` cache keys
* `src/pages/Index.tsx` — Mounted `ResourceCommandCenter` component connecting real incidents and risk zones
* `FEATURES.md` — Marked Resource allocation features as implemented
* `CURRENT_CHANGES.md` — This entry

#### Validation Performed
* `npm run build` — **PASS** (11.39s, bundle generated cleanly)
* `npm run test` — **PASS** (9 test files, 200 tests passing)
* `npx tsc --noEmit` — **PASS** (0 type errors)
* Merge conflict markers search (`<<<<<<<`, `=======`, `>>>>>>>`) — **0 found**