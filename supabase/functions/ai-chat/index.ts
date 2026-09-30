import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are BayWatch AI Assistant, an emergency guidance chatbot for Juhu Beach, Mumbai.

You help users with:
- Beach safety conditions and real-time risk assessment
- Tsunami, flood, and high tide evacuation procedures
- Evacuation routes from Juhu Beach (JVPD Ground 1.2km, Mithibai College 1.5km, Cooper Hospital)
- Emergency contact numbers (Police: 100, Ambulance: 108, Disaster Helpline: 112)
- Weather and tide information
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

  try {
    const { messages, monitoringData, language } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Messages array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context with monitoring data - include source/status
    let contextInfo = "";
    if (monitoringData) {
      const { tideLevel, windSpeed, rainProbability, seaCondition, riskLevel, isLive } = monitoringData;
      const dataSource = isLive ? 'OFFICIAL' : (tideLevel == null ? 'UNAVAILABLE' : 'PREDICTED');
      const tideInfo = tideLevel == null ? 'UNAVAILABLE' : `${tideLevel}m (${dataSource})`;
      const windInfo = windSpeed == null ? 'UNAVAILABLE' : `${windSpeed} km/h (${dataSource})`;
      const rainInfo = rainProbability == null ? 'UNAVAILABLE' : `${rainProbability}% (${dataSource})`;

      contextInfo = `\n\nCurrent monitoring data:
- Tide Level: ${tideInfo}
- Wind Speed: ${windInfo}
- Rain Probability: ${rainInfo}
- Sea Condition: ${seaCondition}
- Risk Level: ${riskLevel}
- User language: ${language || 'en'}`;
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
          ...messages.slice(-10), // Last 10 messages for context
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
