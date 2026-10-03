/**
 * INCIDENT DEMAND CLASSIFICATION MODULE
 *
 * Deterministic demand derivation strictly from verified incidents and structured evidence.
 *
 * RULES:
 * 1. ONLY VERIFIED incidents generate operational demand.
 * 2. Resource types are derived strictly from incident type compatibility.
 * 3. NEVER invent: victim counts, vehicle counts, ETA, resource quantities, or fake severity.
 * 4. Transparent, explainable rationale for every demand generated.
 */

import type { Incident, IncidentType } from '@/integrations/supabase/incidents';
import type { ResourceType } from '@/integrations/supabase/resources';

export interface IncidentDemand {
  incidentId: string;
  incidentType: IncidentType;
  requiredResourceTypes: ResourceType[];
  priority: number;
  rationale: string;
  hasCoordinates: boolean;
  latitude: number | null;
  longitude: number | null;
  verifiedAt: string | null;
  status: 'active_demand' | 'dispatched' | 'resolved' | 'unverified';
}

const TYPE_COMPATIBILITY: Record<IncidentType, { resourceTypes: ResourceType[]; priority: number }> = {
  flooding: {
    resourceTypes: ['water_pump', 'dewatering_pump', 'rescue_team', 'boat', 'ambulance'],
    priority: 1,
  },
  high_waves: {
    resourceTypes: ['rescue_team', 'boat', 'search_rescue_team', 'ambulance'],
    priority: 1,
  },
  blocked_roads: {
    resourceTypes: ['emergency_vehicle', 'rescue_team', 'ambulance'],
    priority: 2,
  },
  other: {
    resourceTypes: ['rescue_team', 'emergency_vehicle'],
    priority: 3,
  },
};

/**
 * Classify operational resource demand from an incident.
 * Returns null if the incident is unverified, rejected, or missing an incident type.
 */
export function deriveIncidentDemand(incident: Incident): IncidentDemand | null {
  if (incident.status === 'unverified' || incident.status === 'rejected') {
    return null;
  }

  const type = incident.type;
  if (!type || !TYPE_COMPATIBILITY[type]) {
    return null;
  }

  const compat = TYPE_COMPATIBILITY[type];

  return {
    incidentId: incident.id,
    incidentType: type,
    requiredResourceTypes: compat.resourceTypes,
    priority: compat.priority,
    rationale: `Verified ${type} incident requires compatible tactical resources: ${compat.resourceTypes.join(', ')}.`,
    hasCoordinates: incident.hasCoordinates,
    latitude: incident.latitude,
    longitude: incident.longitude,
    verifiedAt: incident.verifiedAt,
    status: incident.status === 'resolved' ? 'resolved' : incident.status === 'dispatched' ? 'dispatched' : 'active_demand',
  };
}

/**
 * Derive batch demand for all operational verified incidents.
 */
export function deriveActiveDemands(incidents: Incident[]): IncidentDemand[] {
  return incidents
    .map(deriveIncidentDemand)
    .filter((d): d is IncidentDemand => d !== null && d.status === 'active_demand');
}
