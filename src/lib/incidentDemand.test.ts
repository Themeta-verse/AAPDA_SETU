import { describe, it, expect } from 'vitest';
import { deriveIncidentDemand, deriveActiveDemands } from './incidentDemand';
import type { Incident } from '@/integrations/supabase/incidents';

function makeTestIncident(overrides: Partial<Incident>): Incident {
  return {
    id: 'inc-100',
    reporterId: 'user-1',
    type: 'flooding',
    rawType: 'flooding',
    description: 'Ankle deep water on main street',
    photoPath: 'user-1/photo.jpg',
    latitude: 19.1000,
    longitude: 72.8300,
    hasCoordinates: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    malformed: false,
    status: 'unverified',
    verifiedBy: null,
    verifiedAt: null,
    verificationNotes: null,
    rejectionReason: null,
    clusterId: null,
    evidenceStatus: 'SUFFICIENT',
    resolvedBy: null,
    resolvedAt: null,
    resolutionNotes: null,
    ...overrides,
  };
}

describe('Incident Demand Classification Module', () => {
  it('returns null demand for unverified incidents', () => {
    const unverifiedInc = makeTestIncident({ status: 'unverified' });
    expect(deriveIncidentDemand(unverifiedInc)).toBeNull();
  });

  it('returns null demand for rejected incidents', () => {
    const rejectedInc = makeTestIncident({
      status: 'rejected',
      rejectionReason: 'Duplicate or false report',
    });
    expect(deriveIncidentDemand(rejectedInc)).toBeNull();
  });

  it('derives compatible flood resources for verified flooding incident', () => {
    const verifiedFlood = makeTestIncident({
      status: 'verified',
      type: 'flooding',
      verifiedAt: '2026-10-01T10:30:00.000Z',
    });

    const demand = deriveIncidentDemand(verifiedFlood);
    expect(demand).not.toBeNull();
    expect(demand?.requiredResourceTypes).toContain('water_pump');
    expect(demand?.requiredResourceTypes).toContain('dewatering_pump');
    expect(demand?.requiredResourceTypes).toContain('rescue_team');
    expect(demand?.priority).toBe(1);
    expect(demand?.status).toBe('active_demand');
  });

  it('derives high_waves compatible marine resources for verified high_waves incident', () => {
    const verifiedWaves = makeTestIncident({
      status: 'verified',
      type: 'high_waves',
      verifiedAt: '2026-10-01T10:30:00.000Z',
    });

    const demand = deriveIncidentDemand(verifiedWaves);
    expect(demand).not.toBeNull();
    expect(demand?.requiredResourceTypes).toContain('boat');
    expect(demand?.requiredResourceTypes).toContain('search_rescue_team');
    expect(demand?.requiredResourceTypes).toContain('rescue_team');
  });

  it('derives road clearance vehicles for verified blocked_roads incident', () => {
    const verifiedRoad = makeTestIncident({
      status: 'verified',
      type: 'blocked_roads',
      verifiedAt: '2026-10-01T10:30:00.000Z',
    });

    const demand = deriveIncidentDemand(verifiedRoad);
    expect(demand).not.toBeNull();
    expect(demand?.requiredResourceTypes).toContain('emergency_vehicle');
    expect(demand?.requiredResourceTypes).toContain('rescue_team');
  });

  it('filters active demands strictly from an array of mixed incidents', () => {
    const unverified = makeTestIncident({ id: 'inc-1', status: 'unverified' });
    const verifiedActive = makeTestIncident({ id: 'inc-2', status: 'verified', type: 'flooding' });
    const verifiedDispatched = makeTestIncident({ id: 'inc-3', status: 'dispatched', type: 'flooding' });
    const resolved = makeTestIncident({ id: 'inc-4', status: 'resolved', type: 'flooding' });

    const activeDemands = deriveActiveDemands([unverified, verifiedActive, verifiedDispatched, resolved]);
    expect(activeDemands.length).toBe(1);
    expect(activeDemands[0].incidentId).toBe('inc-2');
  });
});
