import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SendSmsRequest {
  zone_id: string;
  event_type: string;
  severity: 'moderate' | 'high' | 'critical';
  user_location: { latitude: number; longitude: number };
  risk_data: {
    tide_level: number | null;
    wind_speed: number | null;
    rain_probability: number | null;
    risk_level: string;
  };
}

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
  is_primary: boolean;
}

interface SmsRecipient {
  name: string;
  phone: string;
  type: 'user' | 'emergency_contact';
}

function formatPhoneForTwilio(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  return `+${cleaned}`;
}

function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generateSmsMessage(
  eventType: string,
  severity: string,
  userLocation: { latitude: number; longitude: number },
  riskData: SendSmsRequest['risk_data'],
  nearestSafeZone: string
): string {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const eventLabels: Record<string, string> = {
    flood: 'Coastal Flood',
    high_tide: 'High Tide',
    tsunami: 'Tsunami Risk',
    storm: 'Storm Warning',
  };

  const eventLabel = eventLabels[eventType] || eventType;
  const severityLabel = severity.toUpperCase();

  let message = `🚨 BAYWATCH ${severityLabel} ALERT: ${eventLabel}\n`;
  message += `Time: ${timestamp} IST\n`;
  message += `Location: Near Juhu Beach, Mumbai (${userLocation.latitude.toFixed(4)}°N, ${userLocation.longitude.toFixed(4)}°E)\n`;

  if (riskData.tide_level !== null) {
    message += `Tide: ${riskData.tide_level}m\n`;
  }
  if (riskData.wind_speed !== null) {
    message += `Wind: ${riskData.wind_speed} km/h\n`;
  }
  if (riskData.rain_probability !== null) {
    message += `Rain: ${riskData.rain_probability}%\n`;
  }

  message += `\n⚠️ IMMEDIATE ACTION REQUIRED:\n`;

  switch (eventType) {
    case 'tsunami':
      message += '• EVACUATE IMMEDIATELY to higher ground\n• Move inland at least 2km\n• Do not wait for official confirmation';
      break;
    case 'flood':
      message += '• Avoid low-lying areas and coastal roads\n• Move to higher ground\n• Do not drive through flooded roads';
      break;
    case 'high_tide':
      message += '• Stay away from the shoreline\n• Move inland from beach area\n• Monitor official updates';
      break;
    case 'storm':
      message += '• Seek sturdy shelter immediately\n• Avoid coastal areas and open spaces\n• Secure loose objects';
      break;
    default:
      message += '• Follow evacuation routes to safe zones\n• Monitor official emergency channels';
  }

  message += `\n\n🛡 Nearest Safe Zone: ${nearestSafeZone}\n`;
  message += `📞 Emergency: 112 (Disaster) | 108 (Ambulance) | 100 (Police)\n`;
  message += `BayWatch Auto-Alert`;

  return message;
}

function getNearestSafeZone(lat: number, lon: number): string {
  const safeZones = [
    { name: 'JVPD Ground', lat: 19.1020, lon: 72.8350, distance_km: 1.2 },
    { name: 'Mithibai College Area', lat: 19.1045, lon: 72.8380, distance_km: 1.5 },
    { name: 'Cooper Hospital', lat: 19.0990, lon: 72.8420, distance_km: 2.0 },
    { name: 'Juhu Police Station', lat: 19.0960, lon: 72.8300, distance_km: 0.8 },
  ];

  let nearest = safeZones[0];
  let minDist = Infinity;

  for (const zone of safeZones) {
    const R = 6371;
    const dLat = (zone.lat - lat) * Math.PI / 180;
    const dLon = (zone.lon - lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat * Math.PI / 180) * Math.cos(zone.lat * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    if (dist < minDist) {
      minDist = dist;
      nearest = zone;
    }
  }

  return `${nearest.name} (${nearest.distance_km} km inland)`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: SendSmsRequest = await req.json();
    const { zone_id, event_type, severity, user_location, risk_data } = body;

    if (!zone_id || !event_type || !severity || !user_location) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!['moderate', 'high', 'critical'].includes(severity)) {
      return new Response(JSON.stringify({ error: "Invalid severity level" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side risk zone validation
    const { data: zone, error: zoneError } = await supabase
      .from('risk_zones')
      .select('id, name, center_lat, center_lon, alert_threshold_km, severity_threshold, event_types, is_active')
      .eq('id', zone_id)
      .eq('is_active', true)
      .single();

    if (zoneError || !zone) {
      return new Response(JSON.stringify({ error: "Risk zone not found or inactive" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify event_type is configured for this zone
    if (!zone.event_types.includes(event_type)) {
      return new Response(JSON.stringify({ error: `Event type ${event_type} not configured for this risk zone` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify severity meets zone's configured threshold
    const severityOrder: Record<string, number> = { moderate: 1, high: 2, critical: 3 };
    const zoneThreshold = severityOrder[zone.severity_threshold] ?? 2; // default to 'high'
    const requestSeverity = severityOrder[severity] ?? 0;

    if (requestSeverity < zoneThreshold) {
      return new Response(JSON.stringify({ error: `Severity ${severity} does not meet zone threshold ${zone.severity_threshold}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Independently calculate distance from user to zone center
    const distanceKm = calculateHaversineDistance(
      user_location.latitude,
      user_location.longitude,
      zone.center_lat,
      zone.center_lon
    );

    if (distanceKm > zone.alert_threshold_km) {
      return new Response(JSON.stringify({
        error: `User location outside alert threshold`,
        details: { distance_km: distanceKm, threshold_km: zone.alert_threshold_km }
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: shouldSend, error: rpcError } = await supabase.rpc('should_send_alert', {
      p_user_id: user.id,
      p_zone_id: zone_id,
      p_event_type: event_type,
      p_severity: severity,
      p_cooldown_minutes: 60,
    });

    if (rpcError) {
      console.error("RPC error:", rpcError);
      return new Response(JSON.stringify({ error: "Failed to check alert deduplication" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!shouldSend) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        message: "Alert suppressed: recent alert already sent for this event/severity",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('phone, name')
      .eq('id', user.id)
      .single();

    const { data: emergencyContacts } = await supabase
      .from('emergency_contacts')
      .select('id, name, phone, relationship, is_primary')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false });

    const recipients: SmsRecipient[] = [];

    if (profile?.phone) {
      recipients.push({
        name: profile.name || 'User',
        phone: profile.phone,
        type: 'user',
      });
    }

    if (emergencyContacts) {
      for (const contact of emergencyContacts) {
        if (contact.phone) {
          recipients.push({
            name: contact.name,
            phone: contact.phone,
            type: 'emergency_contact',
          });
        }
      }
    }

    if (recipients.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: "No phone numbers available for SMS delivery",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nearestSafeZone = getNearestSafeZone(user_location.latitude, user_location.longitude);
    const message = generateSmsMessage(event_type, severity, user_location, risk_data, nearestSafeZone);

    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioFromNumber = Deno.env.get("TWILIO_FROM_NUMBER");

    const isTestMode = !twilioAccountSid || !twilioAuthToken || !twilioFromNumber;

    const results = [];

    for (const recipient of recipients) {
      const formattedPhone = formatPhoneForTwilio(recipient.phone);

      if (isTestMode) {
        console.log(`[TEST MODE] Would send SMS to ${formattedPhone} (${recipient.name}):`, message);
        results.push({
          recipient: formattedPhone,
          name: recipient.name,
          type: recipient.type,
          status: 'test_mode',
          message: 'SMS not sent - Twilio credentials not configured',
        });
        continue;
      }

      try {
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              From: twilioFromNumber,
              To: formattedPhone,
              Body: message,
            }),
          }
        );

        const twilioResponse = await response.json();

        if (!response.ok) {
          console.error(`Twilio error for ${formattedPhone}:`, twilioResponse);
          results.push({
            recipient: formattedPhone,
            name: recipient.name,
            type: recipient.type,
            status: 'failed',
            error: twilioResponse.message || 'Unknown Twilio error',
          });
        } else {
          results.push({
            recipient: formattedPhone,
            name: recipient.name,
            type: recipient.type,
            status: 'sent',
            message_sid: twilioResponse.sid,
          });
        }
      } catch (e) {
        console.error(`Exception sending to ${formattedPhone}:`, e);
        results.push({
          recipient: formattedPhone,
          name: recipient.name,
          type: recipient.type,
          status: 'failed',
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    const sentCount = results.filter(r => r.status === 'sent' || r.status === 'test_mode').length;
    const failedCount = results.filter(r => r.status === 'failed').length;

    const { error: logError } = await supabase
      .from('sms_alert_log')
      .insert({
        user_id: user.id,
        zone_id: zone_id,
        event_type: event_type,
        severity: severity,
        recipients: results,
        message: message,
        provider_response: { results },
        status: failedCount === 0 ? 'sent' : failedCount === results.length ? 'failed' : 'partial',
      });

    if (logError) {
      console.error("Failed to log SMS alert:", logError);
    }

    return new Response(JSON.stringify({
      success: sentCount > 0,
      sent: sentCount,
      failed: failedCount,
      test_mode: isTestMode,
      results,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("SMS function error:", e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Internal server error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});