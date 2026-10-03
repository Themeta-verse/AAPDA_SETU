/**
 * DETERMINISTIC FORECAST-BASED RISK ASSESSMENT ENGINE
 *
 * Pure deterministic urban flood-risk intelligence layer.
 *
 * Explicitly answers:
 * - WHERE is risk increasing?
 * - HOW severe is it?
 * - WHY?
 * - WHAT happens next?
 * - WHAT sources support this?
 *
 * STRICT INVARIANTS:
 * 1. ZERO ML / AI claims: This is a transparent, deterministic rule-based evaluation.
 * 2. ZERO Math.random() or invented synthetic confidence percentages.
 * 3. NEVER coerce missing or null values into SAFE or 0.
 * 4. Coastal zones require marine observations; if marine data is missing, risk is INSUFFICIENT_DATA.
 * 5. Inland zones treat marine data as NOT_APPLICABLE (distinct from missing/unavailable).
 * 6. Multi-horizon support (+1h, +3h, +6h, +24h) uses ONLY actual forecast points; missing horizons are INSUFFICIENT_DATA.
 */

export type FloodRiskLevel =
  | 'SAFE'
  | 'MODERATE'
  | 'HIGH'
  | 'CRITICAL'
  | 'UNKNOWN'
  | 'INSUFFICIENT_DATA';

export type ForecastHorizon = 'NOW' | '+1H' | '+3H' | '+6H' | '+24H';

export const FORECAST_HORIZONS: readonly ForecastHorizon[] = [
  'NOW',
  '+1H',
  '+3H',
  '+6H',
  '+24H',
] as const;

export const MODEL_VERSION = 'deterministic-flood-v1';

export interface ContributingInput {
  source: string;
  value: number | string | boolean | null;
  unit: string;
  timestamp: string | null;
  freshness: 'live' | 'stale' | 'unavailable' | 'offline';
  rule: string;
  contributionLevel: FloodRiskLevel;
}

export interface HorizonAssessment {
  horizon: ForecastHorizon;
  targetTime: string | null;
  riskLevel: FloodRiskLevel;
  contributingInputs: ContributingInput[];
  explanation: string;
  changeDescription: string;
  trend: 'escalation' | 'persistence' | 'reduction' | 'peak' | 'insufficient_data';
  provenance: {
    sourceNames: string[];
    sourceTimestamps: Record<string, string | null>;
    freshness: 'live' | 'stale' | 'unavailable' | 'offline';
    modelVersion: string;
    missingSources: string[];
  };
}

export interface UrbanFloodAssessmentResult {
  location: {
    city: string;
    ward: string | null;
    zoneId: string | null;
    zoneName: string;
    latitude: number;
    longitude: number;
    isCoastal: boolean;
  };
  currentRisk: HorizonAssessment;
  forecastHorizons: Record<ForecastHorizon, HorizonAssessment>;
  answers: {
    where: string;
    howSevere: string;
    why: string[];
    whatHappensNext: string;
    whatSources: string[];
  };
  assessedAt: string;
  modelVersion: string;
}

export interface HourlyWeatherPoint {
  time: string;
  rainProbability: number | null;
  precipitation?: number | null; // mm
  windSpeed?: number | null; // km/h
}

export interface HourlyMarinePoint {
  time: string;
  waveHeight: number | null; // m
}

export interface FloodRiskInputs {
  location: {
    city: string;
    ward?: string | null;
    zoneId?: string | null;
    zoneName: string;
    latitude: number;
    longitude: number;
    isCoastal: boolean;
  };
  weather: {
    fetchedAt: string | null;
    status: 'live' | 'stale' | 'unavailable' | 'offline';
    current: {
      rainProbability: number | null;
      rainRate?: number | null; // mm/h
      windSpeed: number | null; // km/h
      temperature?: number | null;
    };
    hourly?: HourlyWeatherPoint[];
  };
  marine?: {
    fetchedAt: string | null;
    status: 'live' | 'stale' | 'unavailable' | 'offline';
    current: {
      waveHeight: number | null;
      wavePeriod?: number | null;
      waveDirection?: number | null;
    };
    hourly?: HourlyMarinePoint[];
  } | null;
  tsunamiRisk?: boolean | null;
  verifiedIncidentsInZone?: Array<{
    id: string;
    type: string | null;
    createdAt: string | null;
  }>;
  now?: Date;
}

/** Rank for deterministic maximum-risk synthesis */
const RISK_SEVERITY_ORDER: Record<FloodRiskLevel, number> = {
  UNKNOWN: 0,
  SAFE: 1,
  MODERATE: 2,
  HIGH: 3,
  CRITICAL: 4,
  INSUFFICIENT_DATA: 5,
};

function getHighestRisk(levels: FloodRiskLevel[]): FloodRiskLevel {
  if (levels.length === 0) return 'INSUFFICIENT_DATA';
  if (levels.includes('INSUFFICIENT_DATA')) return 'INSUFFICIENT_DATA';

  let highest: FloodRiskLevel = 'SAFE';
  for (const lvl of levels) {
    if (RISK_SEVERITY_ORDER[lvl] > RISK_SEVERITY_ORDER[highest]) {
      highest = lvl;
    }
  }
  return highest;
}

/**
 * Find the closest forecast point in an hourly array matching target offset in hours.
 */
function findForecastPoint<T extends { time: string }>(
  hourly: T[] | undefined,
  targetDate: Date
): T | null {
  if (!hourly || hourly.length === 0) return null;

  const targetMs = targetDate.getTime();
  let closest: T | null = null;
  let minDiff = Number.POSITIVE_INFINITY;

  for (const pt of hourly) {
    const ptMs = new Date(pt.time).getTime();
    if (Number.isNaN(ptMs)) continue;
    const diff = Math.abs(ptMs - targetMs);
    // Tolerate matching within a 90-minute window
    if (diff <= 90 * 60 * 1000 && diff < minDiff) {
      minDiff = diff;
      closest = pt;
    }
  }

  return closest;
}

/**
 * Pure deterministic risk assessment for a single temporal observation/forecast slice.
 */
export function evaluateRiskSlice(params: {
  isCoastal: boolean;
  rainProbability: number | null;
  rainRate: number | null;
  windSpeed: number | null;
  waveHeight: number | null;
  weatherFreshness: 'live' | 'stale' | 'unavailable' | 'offline';
  marineFreshness: 'live' | 'stale' | 'unavailable' | 'offline';
  marineApplicable: boolean;
  weatherTimestamp: string | null;
  marineTimestamp: string | null;
  tsunamiRisk: boolean;
  verifiedIncidentCount: number;
}): {
  riskLevel: FloodRiskLevel;
  contributions: ContributingInput[];
  missingSources: string[];
} {
  const {
    isCoastal,
    rainProbability,
    rainRate,
    windSpeed,
    waveHeight,
    weatherFreshness,
    marineFreshness,
    marineApplicable,
    weatherTimestamp,
    marineTimestamp,
    tsunamiRisk,
    verifiedIncidentCount,
  } = params;

  const contributions: ContributingInput[] = [];
  const missingSources: string[] = [];

  // 1. Validate Weather Freshness & Availability
  const isWeatherUsable = weatherFreshness === 'live' || weatherFreshness === 'stale';
  if (!isWeatherUsable || (rainProbability === null && rainRate === null && windSpeed === null)) {
    missingSources.push('Open-Meteo Forecast');
    contributions.push({
      source: 'Open-Meteo Forecast',
      value: null,
      unit: '%',
      timestamp: weatherTimestamp,
      freshness: weatherFreshness,
      rule: 'Weather forecast source is unavailable or unparseable',
      contributionLevel: 'INSUFFICIENT_DATA',
    });
  }

  // 2. Validate Marine Freshness & Availability for Coastal Zones
  if (isCoastal && marineApplicable) {
    const isMarineUsable = marineFreshness === 'live' || marineFreshness === 'stale';
    if (!isMarineUsable || waveHeight === null) {
      missingSources.push('Open-Meteo Marine');
      contributions.push({
        source: 'Open-Meteo Marine',
        value: null,
        unit: 'm',
        timestamp: marineTimestamp,
        freshness: marineFreshness,
        rule: 'Coastal zone requires marine sea-state; source is unavailable or missing wave height',
        contributionLevel: 'INSUFFICIENT_DATA',
      });
    }
  }

  // If any mandatory source is missing, the slice cannot make a reliable safe assertion
  if (missingSources.length > 0) {
    return {
      riskLevel: 'INSUFFICIENT_DATA',
      contributions,
      missingSources,
    };
  }

  const factorLevels: FloodRiskLevel[] = [];

  // A. Rainfall Probability Contribution
  if (rainProbability !== null) {
    let rainLevel: FloodRiskLevel = 'SAFE';
    let rainRule = 'Rainfall probability below 50% threshold';

    if (rainProbability >= 85) {
      rainLevel = 'CRITICAL';
      rainRule = 'Precipitation probability >= 85% triggers CRITICAL heavy downpour threshold';
    } else if (rainProbability >= 70) {
      rainLevel = 'HIGH';
      rainRule = 'Precipitation probability >= 70% triggers HIGH urban waterlogging threshold';
    } else if (rainProbability >= 50) {
      rainLevel = 'MODERATE';
      rainRule = 'Precipitation probability >= 50% triggers MODERATE runoff threshold';
    }

    factorLevels.push(rainLevel);
    contributions.push({
      source: 'Open-Meteo Forecast',
      value: rainProbability,
      unit: '%',
      timestamp: weatherTimestamp,
      freshness: weatherFreshness,
      rule: rainRule,
      contributionLevel: rainLevel,
    });
  }

  // B. Rain Intensity (Rate) Contribution if published
  if (rainRate !== null) {
    let rateLevel: FloodRiskLevel = 'SAFE';
    let rateRule = 'Rain intensity <= 5 mm/h within baseline safe drainage';

    if (rainRate > 50) {
      rateLevel = 'CRITICAL';
      rateRule = 'Extreme precipitation rate > 50 mm/h exceeds urban storm drain capacity';
    } else if (rainRate > 20) {
      rateLevel = 'HIGH';
      rateRule = 'Heavy precipitation rate > 20 mm/h triggers high water accumulation';
    } else if (rainRate > 5) {
      rateLevel = 'MODERATE';
      rateRule = 'Moderate precipitation rate > 5 mm/h causes localized surface water';
    }

    factorLevels.push(rateLevel);
    contributions.push({
      source: 'Open-Meteo Forecast',
      value: rainRate,
      unit: 'mm/h',
      timestamp: weatherTimestamp,
      freshness: weatherFreshness,
      rule: rateRule,
      contributionLevel: rateLevel,
    });
  }

  // C. Wind Speed Contribution
  if (windSpeed !== null) {
    let windLevel: FloodRiskLevel = 'SAFE';
    let windRule = 'Wind speed <= 15 km/h';

    if (windSpeed > 40) {
      windLevel = 'CRITICAL';
      windRule = 'Gale winds > 40 km/h severely impair flood barriers and urban transport';
    } else if (windSpeed > 30) {
      windLevel = 'HIGH';
      windRule = 'Strong winds > 30 km/h risk tree falls and storm drain blockages';
    } else if (windSpeed > 15) {
      windLevel = 'MODERATE';
      windRule = 'Moderate winds > 15 km/h';
    }

    factorLevels.push(windLevel);
    contributions.push({
      source: 'Open-Meteo Forecast',
      value: windSpeed,
      unit: 'km/h',
      timestamp: weatherTimestamp,
      freshness: weatherFreshness,
      rule: windRule,
      contributionLevel: windLevel,
    });
  }

  // D. Marine Wave Height Contribution (Coastal only)
  if (isCoastal && marineApplicable && waveHeight !== null) {
    let waveLevel: FloodRiskLevel = 'SAFE';
    let waveRule = 'Wave height <= 2.8m within normal coastal swell';

    if (waveHeight > 4.0) {
      waveLevel = 'CRITICAL';
      waveRule = 'Wave height > 4.0m triggers CRITICAL coastal overtopping & storm surge threshold';
    } else if (waveHeight > 3.5) {
      waveLevel = 'HIGH';
      waveRule = 'Wave height > 3.5m triggers HIGH coastal erosion and beach inundation threshold';
    } else if (waveHeight > 2.8) {
      waveLevel = 'MODERATE';
      waveRule = 'Wave height > 2.8m indicates rough coastal waters';
    }

    factorLevels.push(waveLevel);
    contributions.push({
      source: 'Open-Meteo Marine',
      value: waveHeight,
      unit: 'm',
      timestamp: marineTimestamp,
      freshness: marineFreshness,
      rule: waveRule,
      contributionLevel: waveLevel,
    });
  }

  // E. USGS Tsunami Risk
  if (tsunamiRisk) {
    factorLevels.push('CRITICAL');
    contributions.push({
      source: 'USGS Earthquake Hazards Program',
      value: true,
      unit: 'tsunami_flag',
      timestamp: null,
      freshness: 'live',
      rule: 'Official USGS tsunami flag active for seismic event in regional ocean basin',
      contributionLevel: 'CRITICAL',
    });
  }

  // F. Verified Incidents in Zone (Ground truth verification escalation)
  if (verifiedIncidentCount > 0) {
    const incLevel: FloodRiskLevel = verifiedIncidentCount >= 3 ? 'CRITICAL' : 'HIGH';
    factorLevels.push(incLevel);
    contributions.push({
      source: 'Incident Intelligence',
      value: verifiedIncidentCount,
      unit: 'verified_reports',
      timestamp: null,
      freshness: 'live',
      rule: `${verifiedIncidentCount} verified emergency incident(s) confirmed on ground in this zone`,
      contributionLevel: incLevel,
    });
  }

  const overallRisk = getHighestRisk(factorLevels);

  return {
    riskLevel: overallRisk,
    contributions,
    missingSources,
  };
}

/**
 * Main Pure Deterministic Risk Engine.
 */
export function assessUrbanFloodRisk(inputs: FloodRiskInputs): UrbanFloodAssessmentResult {
  const now = inputs.now ?? new Date();
  const assessedAtIso = now.toISOString();
  const { location, weather, marine, tsunamiRisk = false, verifiedIncidentsInZone = [] } = inputs;

  const isCoastal = location.isCoastal;
  const verifiedCount = verifiedIncidentsInZone.length;

  const horizonOffsets: Record<ForecastHorizon, number> = {
    NOW: 0,
    '+1H': 1,
    '+3H': 3,
    '+6H': 6,
    '+24H': 24,
  };

  const horizonAssessments: Partial<Record<ForecastHorizon, HorizonAssessment>> = {};

  for (const horizon of FORECAST_HORIZONS) {
    const offsetHours = horizonOffsets[horizon];
    const targetDate = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
    const targetTimeIso = targetDate.toISOString();

    let rainProb: number | null = null;
    let rainRate: number | null = null;
    let wind: number | null = null;
    let wave: number | null = null;
    let weatherTs: string | null = weather.fetchedAt;
    let marineTs: string | null = marine?.fetchedAt ?? null;
    let weatherFreshness = weather.status;
    let marineFreshness = marine?.status ?? 'unavailable';

    if (horizon === 'NOW') {
      rainProb = weather.current.rainProbability;
      rainRate = weather.current.rainRate ?? null;
      wind = weather.current.windSpeed;
      wave = isCoastal && marine ? marine.current.waveHeight : null;
    } else {
      // Forecast Horizons: extract from hourly forecast array
      const weatherPt = findForecastPoint(weather.hourly, targetDate);
      if (weatherPt) {
        rainProb = weatherPt.rainProbability;
        rainRate = weatherPt.precipitation ?? null;
        wind = weatherPt.windSpeed ?? null;
        weatherTs = weatherPt.time;
      } else {
        weatherFreshness = 'unavailable';
      }

      if (isCoastal) {
        const marinePt = findForecastPoint(marine?.hourly, targetDate);
        if (marinePt) {
          wave = marinePt.waveHeight;
          marineTs = marinePt.time;
        } else {
          marineFreshness = 'unavailable';
        }
      }
    }

    const { riskLevel, contributions, missingSources } = evaluateRiskSlice({
      isCoastal,
      rainProbability: rainProb,
      rainRate,
      windSpeed: wind,
      waveHeight: isCoastal ? wave : null,
      weatherFreshness,
      marineFreshness,
      marineApplicable: isCoastal,
      weatherTimestamp: weatherTs,
      marineTimestamp: marineTs,
      tsunamiRisk: horizon === 'NOW' ? (tsunamiRisk === true) : false,
      verifiedIncidentCount: horizon === 'NOW' ? verifiedCount : 0,
    });

    const sourceNames = ['Open-Meteo Forecast'];
    if (isCoastal) sourceNames.push('Open-Meteo Marine');
    if (tsunamiRisk && horizon === 'NOW') sourceNames.push('USGS Earthquake Hazards Program');
    if (verifiedCount > 0 && horizon === 'NOW') sourceNames.push('Incident Intelligence');

    // Build structured explanation
    let explanation = `RISK: ${riskLevel}\nWHY:\n`;
    if (riskLevel === 'INSUFFICIENT_DATA') {
      explanation += `• Authoritative data missing: ${missingSources.join(', ')}\n`;
    } else {
      for (const c of contributions) {
        if (c.contributionLevel === riskLevel || c.contributionLevel === 'HIGH' || c.contributionLevel === 'CRITICAL') {
          explanation += `• ${c.rule} (${c.value}${c.unit} from ${c.source})\n`;
        }
      }
      if (contributions.every(c => c.contributionLevel === 'SAFE')) {
        explanation += '• All contributing observations remain below alert thresholds\n';
      }
    }
    explanation += `SOURCE: ${sourceNames.join(', ')}\n`;
    explanation += `UPDATED: ${assessedAtIso}\n`;
    explanation += `MODEL: ${MODEL_VERSION}`;

    horizonAssessments[horizon] = {
      horizon,
      targetTime: targetTimeIso,
      riskLevel,
      contributingInputs: contributions,
      explanation,
      changeDescription: '',
      trend: 'persistence',
      provenance: {
        sourceNames,
        sourceTimestamps: {
          'Open-Meteo Forecast': weatherTs,
          ...(isCoastal ? { 'Open-Meteo Marine': marineTs } : {}),
        },
        freshness: weatherFreshness,
        modelVersion: MODEL_VERSION,
        missingSources,
      },
    };
  }

  // Calculate Deterministic Horizon Comparisons vs NOW
  const nowAssessment = horizonAssessments.NOW!;

  for (const horizon of FORECAST_HORIZONS) {
    if (horizon === 'NOW') {
      nowAssessment.changeDescription = 'Current baseline observation';
      nowAssessment.trend = 'persistence';
      continue;
    }

    const currentH = horizonAssessments[horizon]!;
    if (currentH.riskLevel === 'INSUFFICIENT_DATA' || nowAssessment.riskLevel === 'INSUFFICIENT_DATA') {
      currentH.changeDescription = `Forecast horizon ${horizon} has insufficient authoritative data`;
      currentH.trend = 'insufficient_data';
      continue;
    }

    const nowRank = RISK_SEVERITY_ORDER[nowAssessment.riskLevel];
    const targetRank = RISK_SEVERITY_ORDER[currentH.riskLevel];

    // Find main parameter changes (rain probability, wave height, wind)
    const nowRain = nowAssessment.contributingInputs.find(c => c.source.includes('Forecast') && c.unit === '%')?.value;
    const targetRain = currentH.contributingInputs.find(c => c.source.includes('Forecast') && c.unit === '%')?.value;

    const nowWave = nowAssessment.contributingInputs.find(c => c.source.includes('Marine') && c.unit === 'm')?.value;
    const targetWave = currentH.contributingInputs.find(c => c.source.includes('Marine') && c.unit === 'm')?.value;

    let deltaMsg = '';
    if (typeof nowRain === 'number' && typeof targetRain === 'number' && nowRain !== targetRain) {
      deltaMsg = `Forecast precipitation probability changes from ${nowRain}% to ${targetRain}% by ${horizon}.`;
    } else if (typeof nowWave === 'number' && typeof targetWave === 'number' && nowWave !== targetWave) {
      deltaMsg = `Forecast wave height changes from ${nowWave}m to ${targetWave}m by ${horizon}.`;
    } else {
      deltaMsg = `Forecast conditions persist at ${currentH.riskLevel} through ${horizon}.`;
    }

    if (targetRank > nowRank) {
      currentH.trend = 'escalation';
      currentH.changeDescription = `Risk escalates from ${nowAssessment.riskLevel} to ${currentH.riskLevel}. ${deltaMsg}`;
    } else if (targetRank < nowRank) {
      currentH.trend = 'reduction';
      currentH.changeDescription = `Risk reduces from ${nowAssessment.riskLevel} to ${currentH.riskLevel}. ${deltaMsg}`;
    } else {
      currentH.trend = 'persistence';
      currentH.changeDescription = `Risk remains ${currentH.riskLevel}. ${deltaMsg}`;
    }
  }

  // Answer the 5 required questions
  const zoneDesc = location.ward ? `${location.ward}, ${location.city}` : `${location.zoneName}, ${location.city}`;
  const whereAnswer = `Risk assessment active for ${location.zoneName} (${zoneDesc}) [${location.latitude.toFixed(4)}°N, ${location.longitude.toFixed(4)}°E] — ${isCoastal ? 'Coastal zone' : 'Inland urban zone'}.`;
  const howSevereAnswer = `${nowAssessment.riskLevel} currently; maximum forecast reaches ${
    getHighestRisk(Object.values(horizonAssessments).map(h => h!.riskLevel))
  } across next 24h.`;

  const whyReasons: string[] = [];
  for (const c of nowAssessment.contributingInputs) {
    if (c.contributionLevel !== 'SAFE' && c.contributionLevel !== 'UNKNOWN') {
      whyReasons.push(`${c.source}: ${c.rule} (measured ${c.value} ${c.unit})`);
    }
  }
  if (whyReasons.length === 0) {
    if (nowAssessment.riskLevel === 'SAFE') {
      whyReasons.push('All measured meteorological and marine parameters are within baseline safe levels.');
    } else if (nowAssessment.riskLevel === 'INSUFFICIENT_DATA') {
      whyReasons.push(`Required authoritative data unavailable: ${nowAssessment.provenance.missingSources.join(', ')}.`);
    }
  }

  const nextHorizon = horizonAssessments['+3H'] ?? horizonAssessments['+1H'];
  const whatHappensNextAnswer = nextHorizon?.changeDescription ?? 'Forecast conditions continue steady.';

  const whatSourcesAnswer = nowAssessment.provenance.sourceNames;

  return {
    location,
    currentRisk: nowAssessment,
    forecastHorizons: horizonAssessments as Record<ForecastHorizon, HorizonAssessment>,
    answers: {
      where: whereAnswer,
      howSevere: howSevereAnswer,
      why: whyReasons,
      whatHappensNext: whatHappensNextAnswer,
      whatSources: whatSourcesAnswer,
    },
    assessedAt: assessedAtIso,
    modelVersion: MODEL_VERSION,
  };
}
