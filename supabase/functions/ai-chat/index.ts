import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are BayWatch AI Assistant, an emergency guidance chatbot for Juhu Beach, Mumbai.

You help users with:
- Beach safety conditions and real-time risk assessment
- Tsunami, flood, and high wave evacuation procedures
- Evacuation routes from Juhu Beach (JVPD Ground 1.2km, Mithibai College 1.5km, Cooper Hospital)
- Emergency contact numbers (Police: 100, Ambulance: 108, Disaster Helpline: 112)
- Weather and marine wave information
- NDMA safety guidelines

Key evacuation points from Juhu Beach:
- Safe Zone A: JVPD Ground (1.2 km inland, east)
- Safe Zone B: Mithibai College area (1.5 km inland, northeast)
- Cooper Hospital (emergency shelter, 2 km east)
- Juhu Police Station (0.8 km inland)

Always prioritize safety. If someone reports an emergency, immediately give clear evacuation instructions.
Keep responses concise and actionable. Use numbered steps for procedures.
Respond in the same language as the user's message.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Defense in depth: config.toml already sets verify_jwt = true for this
  // function, so the gateway rejects unauthenticated calls. This explicit
  // check means a misconfigured deployment still refuses anonymous callers
  // rather than exposing a metered third-party LLM call for free.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return new Response(
      JSON.stringify({ reply: "Unauthorized. Please sign in to use the assistant." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Bound the request body so this cannot be used as a free amplification
  // vector against the upstream model.
  const MAX_BODY_BYTES = 16_384;

  try {
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: "Request body too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { messages, monitoringData, language } = JSON.parse(rawBody);

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Messages array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only well-formed, bounded user messages reach the model.
    const sanitized = messages
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .slice(-10)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: (m.content as string).slice(0, 2000),
      }));

    if (sanitized.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid messages supplied" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context with monitoring data - include source/status
    let contextInfo = "";
    if (monitoringData) {
      const { waveHeight, windSpeed, rainProbability, seaCondition, riskLevel, status } = monitoringData;
      // Only describe values as measurements when the source says they are
      // usable. A missing value must read as unavailable, never as a number.
      const isUsable = status === "live" || status === "stale";
      const label = isUsable ? `Open-Meteo (${status})` : "UNAVAILABLE";
      const waveInfo = !isUsable || waveHeight == null ? "UNAVAILABLE" : `${waveHeight}m (${label})`;
      const windInfo = !isUsable || windSpeed == null ? "UNAVAILABLE" : `${windSpeed} km/h (${label})`;
      const rainInfo = !isUsable || rainProbability == null ? "UNAVAILABLE" : `${rainProbability}% (${label})`;
      const seaInfo = !isUsable || seaCondition == null ? "UNAVAILABLE" : seaCondition;
      const riskInfo = isUsable ? riskLevel : "UNAVAILABLE";

      contextInfo = `\n\nCurrent monitoring data:
- Wave Height: ${waveInfo}
- Wind Speed: ${windInfo}
- Rain Probability: ${rainInfo}
- Sea Condition: ${seaInfo}
- Risk Level: ${riskInfo}
- Source Status: ${status || "UNAVAILABLE"}
- User language: ${language || "en"}`;

      if (!isUsable) {
        contextInfo += "\n\nIMPORTANT: live sensor data is currently unavailable. Tell the user that conditions are unknown and that they must follow official NDMA/BMC instructions or call 112. Do not describe conditions as safe.";
      }
    }

    const response = await fetch("https://ai.lovable.dev/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT + contextInfo },
          ...sanitized, // Last 10 messages for context
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI API error:", response.status, errorText);
      throw new Error(`AI API failed: ${response.status}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "I'm unable to respond right now. For emergencies, call 112.";

    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("AI chat error:", e);
    return new Response(
      JSON.stringify({
        reply: "I'm experiencing technical difficulties. For emergencies, call 112 (Disaster Helpline) or 108 (Ambulance).",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
