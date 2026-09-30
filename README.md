# AAPDA SETU

**Urban Disaster Intelligence & Emergency Response Platform**

[Live Deployment](https://baywatch-mumbai.vercel.app/)

---

## Project Description

AAPDA SETU is a real-time disaster management dashboard that aggregates weather forecasts, social media signals, geographic data, and emergency resource availability to predict and manage urban flooding scenarios. The system incorporates flood-risk modelling, geospatial vulnerability mapping, real-time incident verification, dynamic evacuation route recommendations, resource allocation optimization, and severity-based alerts for emergency response teams.

---

## Current Prototype Capabilities

- **Real-time monitoring dashboard** with live weather and marine data from Open-Meteo
- **Earthquake detection** via USGS integration
- **Citizen incident reporting** with photo submission
- **Multilingual support** (English, Hindi, Marathi, Gujarati)
- **Emergency voice alerts** via browser TTS and ElevenLabs integration
- **Scenario simulation** for disaster preparedness training
- **Evacuation map** with safe zone information
- **Government guidelines** following NDMA recommendations
- **Tourist safety mode** with simplified instructions

---

## Development Stack

- **Frontend**: React 18 + TypeScript + Vite
- **UI Components**: shadcn-ui + Tailwind CSS
- **State Management**: TanStack React Query
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Maps**: OpenStreetMap integration
- **Charts**: Recharts
- **Animations**: Framer Motion
- **Voice**: ElevenLabs TTS + Browser SpeechSynthesis fallback
- **Translations**: Custom multilingual system (en/hi/mr/gu)

---

## Development Status

**Round 2 Complete**: Data integrity foundation secured, synthetic `Math.random()` removed from operational monitoring, LIVE indicators now only appear with real fresh data, security hardening implemented (RLS policies, storage authentication, edge function JWT verification).

**Next Phase**: Official data source integration (IMD, INCOIS, BMC/MCGM, NDMA/SACHET, OSRM routing).

---

## Important Notes

- This is a prototype for disaster management research and education
- All prediction models are heuristic-based and include explicit uncertainty communication
- No fake data presented as real; unavailable data shows clear "UNAVAILABLE" status
- Emergency always: Call 112 (Disaster Helpline) or 108 (Ambulance)
- Follow official NDMA guidelines for all safety procedures

---

## Available Scripts

```sh
npm run dev      # Start development server
npm run build    # Build for production
npm run lint     # lint check
npm run test     # Run tests
```

---

## Data Sources (Integrated)

- **Open-Meteo**: Weather & marine forecasts
- **USGS**: Earthquake feed

**Planned Sources**: IMD, INCOIS, BMC/MCGM, NDMA/SACHET, OSRM