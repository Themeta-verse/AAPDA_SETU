import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { CitizenSOS } from './CitizenSOS';
import { IncidentIntelligence } from './IncidentIntelligence';
import { DeterministicFloodAssessment } from './DeterministicFloodAssessment';
import type { IncidentClientLike } from '@/integrations/supabase/incidents';
import { type UrbanFloodAssessmentResult, assessUrbanFloodRisk } from '@/lib/floodIntelligence';
import { setResourceSchemaAvailability } from '@/integrations/supabase/resources';

type Row = Record<string, unknown>;

function mockUser(role: 'admin' | 'responder' | 'citizen' = 'citizen'): User {
  return {
    id: 'user-test-uuid-1',
    email: 'test@aapda.gov.in',
    app_metadata: { role: role === 'citizen' ? undefined : role },
    user_metadata: { name: 'Field Operator' },
  } as unknown as User;
}

describe('Final Feature Pass: Citizen SOS → Incident Command → Resource Dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    setResourceSchemaAvailability(true);
  });

  describe('Feature 2: Citizen SOS Emergency Beacon', () => {
    it('renders all 4 emergency types: FLOOD, TRAPPED, MEDICAL, OTHER', () => {
      render(<CitizenSOS language="en" userId="citizen-user-1" />);

      expect(screen.getByTestId('sos-type-flood')).toBeInTheDocument();
      expect(screen.getByTestId('sos-type-trapped')).toBeInTheDocument();
      expect(screen.getByTestId('sos-type-medical')).toBeInTheDocument();
      expect(screen.getByTestId('sos-type-other')).toBeInTheDocument();
    });

    it('requires authentication to transmit an SOS beacon', async () => {
      render(<CitizenSOS language="en" userId={undefined} />);

      const sendBtn = screen.getByTestId('send-sos-btn');
      fireEvent.click(sendBtn);

      expect(await screen.findByTestId('sos-error-banner')).toBeInTheDocument();
      expect(screen.getByText(/sign-in required/i)).toBeInTheDocument();
    });

    it('submits a real SOS record with selected type and transmits to backend', async () => {
      let insertedRecord: Record<string, unknown> | null = null;
      const fakeClient: IncidentClientLike = {
        from: (table: string) => ({
          insert: (val: Record<string, unknown>) => {
            if (table === 'incident_reports') {
              insertedRecord = { id: 'sos-12345678-test', ...val };
              return Promise.resolve({ data: insertedRecord, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
        storage: {
          from: () => ({
            upload: () => Promise.resolve({ error: null }),
            createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://photo' }, error: null }),
          }),
        },
      };

      render(
        <CitizenSOS
          language="en"
          userId="citizen-user-1"
          client={fakeClient}
        />
      );

      // Select TRAPPED
      fireEvent.click(screen.getByTestId('sos-type-trapped'));

      // Enter details
      const detailsInput = screen.getByTestId('sos-details-input');
      fireEvent.change(detailsInput, { target: { value: 'Water rising up to 2nd floor balcony' } });

      // Transmit SOS
      fireEvent.click(screen.getByTestId('send-sos-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('sos-success-state')).toBeInTheDocument();
      });

      expect(insertedRecord).not.toBeNull();
      expect(insertedRecord?.type).toBe('flooding');
      expect(String(insertedRecord?.description)).toContain('[URGENT SOS: TRAPPED]');
      expect(String(insertedRecord?.description)).toContain('Water rising up to 2nd floor balcony');
      expect(insertedRecord?.user_id).toBe('citizen-user-1');
      expect(screen.getByText(/#BW-SOS-1234/i)).toBeInTheDocument();
    });

    it('displays location unavailable honestly when GPS is not active without fake coordinates', () => {
      render(<CitizenSOS language="en" userId="citizen-user-1" />);

      // Geolocation is not mocked in this unit environment, so it renders unavailable
      expect(screen.getByTestId('sos-gps-unavailable')).toBeInTheDocument();
      expect(screen.getByText(/location unavailable/i)).toBeInTheDocument();
    });
  });

  describe('Feature 1: Incident Command & Resource Dispatch', () => {
    function makeIncident(overrides: Row = {}): Row {
      return {
        id: '22222222-2222-4222-8222-222222222222',
        user_id: 'citizen-user-1',
        type: 'flooding',
        description: '[URGENT SOS: FLOOD] Immediate water extraction needed',
        photo_url: null,
        latitude: 19.1000,
        longitude: 72.8300,
        status: 'unverified',
        created_at: '2026-10-01T10:00:00.000Z',
        ...overrides,
      };
    }

    function makeResource(overrides: Row = {}): Row {
      return {
        id: 'res-ambulance-01',
        resource_type: 'ambulance',
        name: 'Ambulance 04',
        status: 'available',
        quantity: 3,
        available_quantity: 2,
        zone_id: null,
        latitude: 19.1000,
        longitude: 72.8300,
        capacity: 4,
        metadata: {},
        created_at: '2026-10-01T08:00:00.000Z',
        created_by: 'admin-1',
        ...overrides,
      };
    }

    it('renders urgent SOS badge and allows operator to acknowledge emergency', async () => {
      let updatedStatus: string | null = null;
      const fakeClient = {
        from: (table: string) => {
          if (table === 'incident_reports') {
            return {
              select: () => ({
                order: () => Promise.resolve({ data: [makeIncident()], error: null }),
              }),
              update: (val: Record<string, unknown>) => {
                updatedStatus = val.status as string;
                return {
                  eq: () => Promise.resolve({ data: null, error: null }),
                };
              },
            };
          }
          if (table === 'incident_audit_logs') {
            return {
              insert: () => Promise.resolve({ data: null, error: null }),
              select: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            };
          }
          if (table === 'resources' || table === 'resource_allocations') {
            return {
              select: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
                eq: () => ({
                  single: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        },
        storage: {
          from: () => ({
            createSignedUrl: () => Promise.resolve({ data: { signedUrl: null }, error: null }),
          }),
        },
      };

      render(
        <IncidentIntelligence
          language="en"
          user={mockUser('responder')}
          client={fakeClient as unknown as IncidentClientLike}
        />
      );

      // Verify Incident ID is rendered
      expect(await screen.findByText(/#BW-22222222/i)).toBeInTheDocument();
      // Verify SOS badge is rendered
      expect(screen.getAllByText(/URGENT SOS: FLOOD/i).length).toBeGreaterThan(0);

      // Click acknowledge SOS
      const ackBtn = screen.getByTestId('verify-btn-22222222-2222-4222-8222-222222222222');
      expect(ackBtn).toHaveTextContent(/Acknowledge SOS/i);
      fireEvent.click(ackBtn);

      await waitFor(() => {
        expect(updatedStatus).toBe('verified');
      });
    });

    it('renders tactical resource command panel for verified incidents and handles dispatch', async () => {
      let createdAllocation: Record<string, unknown> | null = null;
      let updatedIncidentStatus: string | null = null;
      const resourceRow = makeResource();

      const fakeClient = {
        from: (table: string) => {
          if (table === 'incident_reports') {
            return {
              select: () => ({
                order: () =>
                  Promise.resolve({
                    data: [makeIncident({ status: 'verified' })],
                    error: null,
                  }),
              }),
              update: (val: Record<string, unknown>) => {
                updatedIncidentStatus = val.status as string;
                return {
                  eq: () => Promise.resolve({ data: null, error: null }),
                };
              },
            };
          }
          if (table === 'resources') {
            return {
              select: () => ({
                order: () => Promise.resolve({ data: [resourceRow], error: null }),
                eq: () => ({
                  single: () => Promise.resolve({ data: resourceRow, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            };
          }
          if (table === 'resource_allocations') {
            return {
              select: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
              insert: (val: Record<string, unknown>) => {
                createdAllocation = { id: 'alloc-99', ...val };
                return {
                  select: () => ({
                    single: () => Promise.resolve({ data: createdAllocation, error: null }),
                  }),
                };
              },
            };
          }
          if (table === 'incident_audit_logs' || table === 'resource_audit_logs') {
            return {
              insert: () => Promise.resolve({ data: null, error: null }),
              select: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            };
          }
          return {
            select: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        },
        storage: {
          from: () => ({
            createSignedUrl: () => Promise.resolve({ data: { signedUrl: null }, error: null }),
          }),
        },
      };

      render(
        <IncidentIntelligence
          language="en"
          user={mockUser('admin')}
          client={fakeClient as unknown as IncidentClientLike}
        />
      );

      // Verify Resource Command & Dispatch section exists
      expect(
        await screen.findByTestId('incident-command-panel-22222222-2222-4222-8222-222222222222')
      ).toBeInTheDocument();

      // Check available resource option
      expect(screen.getByText(/Ambulance 04/i)).toBeInTheDocument();

      // Click dispatch button
      const dispatchBtn = screen.getByTestId('dispatch-btn-22222222-2222-4222-8222-222222222222');
      fireEvent.click(dispatchBtn);

      await waitFor(() => {
        expect(createdAllocation).not.toBeNull();
      });

      expect(createdAllocation?.resource_id).toBe('res-ambulance-01');
      expect(createdAllocation?.status).toBe('deployed');
      expect(createdAllocation?.incident_id).toBe('22222222-2222-4222-8222-222222222222');
      expect(updatedIncidentStatus).toBe('dispatched');
    });

    it('gracefully degrades with honest notice when resource schema is unavailable', async () => {
      setResourceSchemaAvailability(false);

      const fakeClient = {
        from: (table: string) => {
          if (table === 'incident_reports') {
            return {
              select: () => ({
                order: () =>
                  Promise.resolve({
                    data: [makeIncident({ status: 'verified' })],
                    error: null,
                  }),
              }),
            };
          }
          return {
            select: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        },
        storage: {
          from: () => ({
            createSignedUrl: () => Promise.resolve({ data: { signedUrl: null }, error: null }),
          }),
        },
      };

      render(
        <IncidentIntelligence
          language="en"
          user={mockUser('admin')}
          client={fakeClient as unknown as IncidentClientLike}
        />
      );

      expect(
        await screen.findByTestId('incident-command-panel-22222222-2222-4222-8222-222222222222')
      ).toBeInTheDocument();

      // Notice should be clearly visible without crash or fake buttons
      expect(screen.getByTestId('resource-not-configured-notice')).toBeInTheDocument();
      expect(screen.getByText(/Resource Management Not Configured/i)).toBeInTheDocument();
    });

    it('expands authoritative Case File & Audit Trail with chronological events', async () => {
      const auditRows = [
        {
          id: 'audit-1',
          incident_id: '22222222-2222-4222-8222-222222222222',
          performed_by: 'user-citizen-1',
          action: 'sos_created',
          previous_status: null,
          new_status: 'unverified',
          notes: 'Emergency beacon triggered by citizen',
          created_at: '2026-10-01T10:00:00.000Z',
        },
        {
          id: 'audit-2',
          incident_id: '22222222-2222-4222-8222-222222222222',
          performed_by: 'resp-user-1',
          action: 'verify',
          previous_status: 'unverified',
          new_status: 'verified',
          notes: 'Citizen emergency SOS acknowledged by Incident Command',
          created_at: '2026-10-01T10:02:00.000Z',
        },
      ];

      const fakeClient = {
        from: (table: string) => {
          if (table === 'incident_reports') {
            return {
              select: () => ({
                order: () =>
                  Promise.resolve({
                    data: [makeIncident({ status: 'verified' })],
                    error: null,
                  }),
              }),
            };
          }
          if (table === 'incident_audit_logs') {
            return {
              select: () => ({
                order: () => Promise.resolve({ data: auditRows, error: null }),
              }),
            };
          }
          return {
            select: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        },
        storage: {
          from: () => ({
            createSignedUrl: () => Promise.resolve({ data: { signedUrl: null }, error: null }),
          }),
        },
      };

      render(
        <IncidentIntelligence
          language="en"
          user={mockUser('admin')}
          client={fakeClient as unknown as IncidentClientLike}
        />
      );

      const toggleBtn = await screen.findByTestId('toggle-audit-btn-22222222-2222-4222-8222-222222222222');
      fireEvent.click(toggleBtn);

      expect(
        await screen.findByTestId('audit-log-drawer-22222222-2222-4222-8222-222222222222')
      ).toBeInTheDocument();
      expect(screen.getByText(/sos_created/i)).toBeInTheDocument();
      expect(screen.getByText(/verify/i)).toBeInTheDocument();
      expect(screen.getByText(/Emergency beacon triggered by citizen/i)).toBeInTheDocument();
    });
  });

  describe('Flood Intelligence → Incident Command connection', () => {
    it('renders navigation button to Incident Command when onNavigateToCommand is supplied', () => {
      const mockNavigate = vi.fn();
      const assessment: UrbanFloodAssessmentResult = assessUrbanFloodRisk({
        location: {
          city: 'Mumbai',
          zoneId: 'zone-juhu',
          zoneName: 'Juhu Beach',
          latitude: 19.0988,
          longitude: 72.8267,
          isCoastal: true,
        },
        weather: {
          fetchedAt: '2026-10-01T10:00:00.000Z',
          status: 'live',
          current: {
            rainProbability: 90,
            windSpeed: 45,
            temperature: 28,
          },
          hourly: [],
        },
        marine: {
          fetchedAt: '2026-10-01T10:00:00.000Z',
          status: 'live',
          current: {
            waveHeight: 3.5,
            wavePeriod: 12,
            waveDirection: 250,
          },
          hourly: [],
        },
        tsunamiRisk: false,
        verifiedIncidentsInZone: [],
      });

      render(
        <DeterministicFloodAssessment
          assessment={assessment}
          language="en"
          onNavigateToCommand={mockNavigate}
        />
      );

      const navBtn = screen.getByTestId('navigate-command-btn');
      expect(navBtn).toBeInTheDocument();
      fireEvent.click(navBtn);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });
  });
});
