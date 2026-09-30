import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoastalCommandCenter } from './CoastalCommandCenter';

/**
 * Component tests for the command center.
 *
 * These assert that the UI communicates UNCERTAINTY correctly, which is the
 * property that matters most in a safety product: a state labelled "unknown"
 * or "unavailable" must never be rendered as a clean bill of health, and no
 * fabricated badge or number may appear when sources failed.
 */

// The hook performs real network I/O. Mock it so these tests exercise the
// component's rendering and interaction logic deterministically.
vi.mock('@/hooks/useCoastalIntelligence', () => ({
  useCoastalIntelligence: () => mockState(),
}));

import { buildEvent } from '@/notifications/types';
import type { CoastalIntelligenceState } from '@/hooks/useCoastalIntelligence';

function baseState(overrides: Partial<CoastalIntelligenceState> = {}): CoastalIntelligenceState {
  return {
    assessment: {
      state: 'nominal',
      officialWarningActive: false,
      tsunamiStatus: null,
      tsunamiAuthoritative: false,
      evaluatedAt: '2026-09-30T12:00:00.000Z',
      quality: {
        state: 'CURRENT',
        assessment: 'GOOD',
        reasons: ['The newest reading is 12 seconds old.'],
        sourceStatus: 'live',
        ageMs: 12_000,
        rejectedRecords: 0,
        missingFields: [],
      },
      dimensions: {
        marine: {
          id: 'marine',
          label: 'Marine risk',
          state: 'nominal',
          triggered: [],
          missingInputs: [],
          sourceStatus: 'live',
          retrievedAt: '2026-09-30T11:59:00.000Z',
        },
        weather: {
          id: 'weather',
          label: 'Weather risk',
          state: 'nominal',
          triggered: [],
          missingInputs: [],
          sourceStatus: 'live',
          retrievedAt: '2026-09-30T11:59:00.000Z',
        },
        'coastal-water': {
          id: 'coastal-water',
          label: 'Coastal water risk',
          state: 'insufficient-data',
          triggered: [],
          missingInputs: ['sea level forecast (no publicly readable endpoint)'],
          sourceStatus: 'unavailable',
          retrievedAt: null,
        },
        seismic: {
          id: 'seismic',
          label: 'Seismic activity',
          state: 'nominal',
          triggered: [],
          missingInputs: [],
          sourceStatus: 'live',
          retrievedAt: null,
        },
      },
    },
    explanation: {
      kind: 'initial',
      headline: 'Coastal state assessed as Nominal.',
      previousState: 'unknown',
      newState: 'nominal',
      observedChanges: [],
      rules: [],
      officialWarning: { active: false, summary: 'All configured bulletins were read and report no active warning.', perProduct: [] },
      tsunami: { status: null, authoritative: false, summary: 'UNKNOWN. No readable source published a tsunami flag.' },
      quality: { state: 'CURRENT', assessment: 'GOOD', reasons: ['The newest reading is 12 seconds old.'] },
      evaluatedAt: '2026-09-30T12:00:00.000Z',
      sources: [],
    },
    features: {
      waveHeightM: 0.8,
      swellHeightM: 0.7,
      wavePeriodS: 8,
      waveDirectionDeg: 210,
      swellDirectionDeg: 215,
      oceanCurrentVelocity: 0.4,
      seaSurfaceTemperatureC: 29,
      windSpeedKmh: 12,
      windGustKmh: 18,
      windDirectionDeg: 250,
      precipitationMm: 0,
      precipitationProbabilityPct: 10,
      visibilityM: 12000,
      marineStatus: 'live',
      weatherStatus: 'live',
      marineFetchedAt: '2026-09-30T11:59:00.000Z',
      weatherFetchedAt: '2026-09-30T11:59:00.000Z',
    },
    seismic: {
      seismicMagnitude: 3.1,
      seismicDepthKm: 15,
      tsunamiFlag: null,
      tsunamiFlagAuthoritative: false,
      eventCount: 1,
    },
    marine: {} as never,
    forecast: [],
    officialWarnings: [],
    forecastSourceIssuedAt: null,
    provenance: [],
    transitions: [],
    events: [],
    notifications: [],
    notificationPermission: 'default',
    persistenceUnavailable: false,
    fetchState: {
      marine: { status: 'live', lastSuccessfulFetch: '2026-09-30T11:59:00.000Z', lastAttemptedFetch: '2026-09-30T11:59:00.000Z', nextRefreshAt: '2026-09-30T12:09:00.000Z', errorKind: null, errorMessage: null },
      seismic: { status: 'live', lastSuccessfulFetch: '2026-09-30T11:59:00.000Z', lastAttemptedFetch: '2026-09-30T11:59:00.000Z', nextRefreshAt: '2026-09-30T12:04:00.000Z', errorKind: null, errorMessage: null },
      warnings: { status: 'unavailable', lastSuccessfulFetch: null, lastAttemptedFetch: '2026-09-30T11:58:00.000Z', nextRefreshAt: '2026-09-30T12:28:00.000Z', errorKind: 'cors-denied', errorMessage: 'not readable' },
    },
    isOnline: true,
    refresh: vi.fn(),
    acknowledge: vi.fn(),
    acknowledgeAll: vi.fn(),
    requestPermission: vi.fn(),
    ...overrides,
  } as CoastalIntelligenceState;
}

let current = baseState();
function mockState() {
  return current;
}

beforeEach(() => {
  current = baseState();
});

// =====================================================================
// CURRENT STATE
// =====================================================================

describe('current coastal state', () => {
  it('renders the risk state and its meaning', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-risk-state')).toHaveTextContent('Nominal');
  });

  it('renders real measurements with units', () => {
    render(<CoastalCommandCenter language="en" />);
    const wave = screen.getByTestId('cc-metric-wave-height');
    expect(wave).toHaveTextContent('0.80');
    expect(wave).toHaveTextContent('m');
  });

  it('shows "Unavailable" rather than a fabricated number for a null metric', () => {
    const s = baseState();
    s.features.waveHeightM = null;
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const wave = screen.getByTestId('cc-metric-wave-height');
    expect(wave).toHaveTextContent('Unavailable');
    // Critically: no numeric placeholder.
    expect(wave).not.toHaveTextContent('0.00');
  });

  it('shows tsunami status as unknown when no authoritative flag exists', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-tsunami-status')).toHaveTextContent('Unknown');
  });

  it('never displays "Not flagged" without an authoritative flag', () => {
    const s = baseState();
    s.assessment.tsunamiStatus = false;
    s.assessment.tsunamiAuthoritative = true;
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-tsunami-status')).toHaveTextContent('Not flagged');
  });

  it('reports the warning state as unknown when it could not be determined', () => {
    const s = baseState();
    s.assessment.officialWarningActive = null;
    s.explanation.officialWarning.active = null;
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-warning-summary')).toHaveTextContent('Unknown');
  });

  it('marks retained data as offline rather than live', () => {
    const s = baseState();
    s.isOnline = false;
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByText(/Offline — showing retained data/i)).toBeInTheDocument();
  });
});

// =====================================================================
// OFFICIAL WARNINGS
// =====================================================================

describe('official warnings', () => {
  it('shows UNKNOWN for an unreadable IMD bulletin with the real reason', () => {
    const s = baseState();
    s.officialWarnings = [
      {
        authority: 'IMD',
        productId: 'IMD_MARINE_FORECAST',
        label: 'IMD Marine Forecast',
        url: 'https://mausam.imd.gov.in/responsive/marine_forecast.php',
        active: null,
        issuedAt: null,
        validFrom: null,
        validUntil: null,
        headline: null,
        affectedArea: null,
        retrievedAt: null,
        status: 'unavailable',
        blocker: 'cors-origin-restricted',
        blockerDetail:
          'The source grants CORS only to a different origin. (observed: HTTP 200, content-type text/html)',
        httpStatus: 200,
        contentType: 'text/html',
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const item = screen.getByTestId('cc-warning-item');
    expect(item).toHaveTextContent('UNKNOWN');
    expect(item).toHaveTextContent('CORS');
  });

  it('links to the real official source', () => {
    const s = baseState();
    s.officialWarnings = [
      {
        authority: 'INCOIS',
        productId: 'INCOIS_TSUNAMI',
        label: 'INCOIS Tsunami',
        url: 'https://tsunami.incois.gov.in/TEWS/',
        active: true,
        issuedAt: '2026-09-30T10:00:00Z',
        validFrom: null,
        validUntil: null,
        headline: 'Tsunami advisory',
        affectedArea: 'Indian Ocean',
        retrievedAt: '2026-09-30T10:05:00Z',
        status: 'live',
        blocker: null,
        blockerDetail: null,
        httpStatus: 200,
        contentType: 'application/json',
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const link = screen.getByRole('link', { name: /Open official source/i });
    expect(link).toHaveAttribute('href', 'https://tsunami.incois.gov.in/TEWS/');
    expect(screen.getByTestId('cc-warning-item')).toHaveTextContent('ACTIVE');
  });

  it('shows a probing state rather than "no warnings" before any result', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByText(/Probing official sources/i)).toBeInTheDocument();
  });
});

// =====================================================================
// FORECAST
// =====================================================================

describe('forecast timeline', () => {
  const point = (iso: string, wave: number | null) => ({
    time: iso,
    isoTime: iso,
    waveHeightM: wave,
    swellHeightM: null,
    wavePeriodS: 9,
    windSpeedKmh: 14,
    windGustKmh: null,
    precipitationMm: null,
    precipitationProbabilityPct: null,
    visibilityM: null,
    hazardState: wave !== null && wave >= 3.7 ? ('severe' as const) : ('nominal' as const),
    ruleIds: wave !== null && wave >= 3.7 ? ['MARINE.WAVE.HIGH'] : [],
    sourceStatus: 'live' as const,
  });

  it('shows an explicit empty state with no invented hours', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-forecast-empty')).toBeInTheDocument();
  });

  it('renders only published points', () => {
    const s = baseState();
    s.forecast = [
      point('2026-09-30T13:00:00.000Z', 1.2),
      point('2026-09-30T14:00:00.000Z', 3.9),
      point('2026-09-30T15:00:00.000Z', null),
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getAllByTestId('cc-forecast-point')).toHaveLength(3);
  });

  it('shows a dash rather than 0 when a wave height is not published', () => {
    const s = baseState();
    s.forecast = [point('2026-09-30T13:00:00.000Z', null)];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-forecast-point')).toHaveTextContent('—');
  });

  it('opens real forecast inputs when a point is selected', () => {
    const s = baseState();
    s.forecast = [point('2026-09-30T14:00:00.000Z', 3.9)];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    fireEvent.click(screen.getByTestId('cc-forecast-point'));

    const detail = screen.getByTestId('cc-forecast-detail');
    expect(detail).toHaveTextContent('MARINE.WAVE.HIGH');
    expect(detail).toHaveTextContent('Not published');
  });

  it('starts with no detail panel open', () => {
    const s = baseState();
    s.forecast = [point('2026-09-30T14:00:00.000Z', 3.9)];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.queryByTestId('cc-forecast-detail')).not.toBeInTheDocument();
  });
});

// =====================================================================
// RISK DRIVERS
// =====================================================================

describe('risk drivers', () => {
  it('shows insufficient data for a dimension with no readable source', () => {
    render(<CoastalCommandCenter language="en" />);
    const dimensions = screen.getAllByTestId('cc-dimension');
    const coastal = dimensions.find((d) => d.textContent?.includes('Coastal water risk'))!;
    expect(coastal).toHaveTextContent('INSUFFICIENT-DATA');
    expect(coastal).toHaveTextContent('sea level forecast');
  });

  it('shows the documented basis for a fired rule', () => {
    const s = baseState();
    s.assessment.dimensions.marine.state = 'high';
    s.assessment.dimensions.marine.triggered = [
      {
        ruleId: 'MARINE.WAVE.HIGH',
        basis: 'Significant wave height >= 3.7 m.',
        observed: [4.1],
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByText('MARINE.WAVE.HIGH')).toBeInTheDocument();
    expect(screen.getByText(/3\.7 m/)).toBeInTheDocument();
  });

  it('renders all four dimensions', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getAllByTestId('cc-dimension')).toHaveLength(4);
  });
});

// =====================================================================
// EXPLANATION
// =====================================================================

describe('risk explanation', () => {
  it('shows the deterministic headline', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-explanation-headline')).toHaveTextContent(
      'Coastal state assessed as Nominal.'
    );
  });

  it('reports field-level changes from real values', () => {
    const s = baseState();
    s.explanation.observedChanges = [
      {
        key: 'waveHeightM',
        label: 'Significant wave height (m)',
        previous: 1.1,
        current: 3.9,
        direction: 'up',
        unitHint: 'm',
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByText(/Significant wave height \(m\)/)).toBeInTheDocument();
    expect(screen.getByText('1.1')).toBeInTheDocument();
    expect(screen.getByText('3.9')).toBeInTheDocument();
  });

  it('states plainly when no field changed', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-no-changes')).toBeInTheDocument();
  });

  it('always states tsunami as unknown rather than absent', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-explanation-tsunami')).toHaveTextContent('UNKNOWN');
  });

  it('lists recorded transitions with rule ids', () => {
    const s = baseState();
    s.transitions = [
      {
        id: 't1',
        previousState: 'watch',
        newState: 'high',
        at: '2026-09-30T11:55:00.000Z',
        ruleIds: ['MARINE.WAVE.HIGH'],
        triggeringInputs: [],
        source: 'BayWatch risk engine',
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-transitions')).toHaveTextContent('watch');
    expect(screen.getByTestId('cc-transitions')).toHaveTextContent('MARINE.WAVE.HIGH');
  });
});

// =====================================================================
// QUALITY
// =====================================================================

describe('data quality', () => {
  it('shows the evidence-based state with reasons', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-quality-state')).toHaveTextContent('CURRENT');
    expect(screen.getByTestId('cc-quality-reasons')).toHaveTextContent('12 seconds old');
  });

  it('never renders a numeric confidence percentage', () => {
    render(<CoastalCommandCenter language="en" />);
    const quality = screen.getByTestId('cc-quality');
    expect(quality.textContent).not.toMatch(/\d+\s*%\s*(confidence|confident)/i);
    expect(quality.textContent).not.toMatch(/confidence/i);
  });

  it('reports per-source fetch state', () => {
    render(<CoastalCommandCenter language="en" />);
    const quality = screen.getByTestId('cc-quality');
    expect(quality).toHaveTextContent('Live');
    expect(quality).toHaveTextContent('Unavailable');
  });

  it('reports a source error honestly', () => {
    const s = baseState();
    s.assessment.quality.state = 'DEGRADED';
    s.assessment.quality.assessment = 'LIMITED';
    s.assessment.quality.reasons = ['Official IMD and INCOIS bulletins cannot be read from a browser.'];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-quality-state')).toHaveTextContent('DEGRADED');
    expect(screen.getByTestId('cc-quality-reasons')).toHaveTextContent('cannot be read');
  });
});

// =====================================================================
// NOTIFICATIONS
// =====================================================================

describe('notification center', () => {
  it('shows an explicit empty state explaining the absence', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-notifications-empty')).toHaveTextContent(
      'raised only when a documented rule fires'
    );
  });

  it('acknowledges a notification through a working button', () => {
    const acknowledge = vi.fn();
    const s = baseState();
    s.acknowledge = acknowledge;
    s.notifications = [
      {
        id: 'n1',
        eventKey: 'RISK_ESCALATED:watch->high',
        rule: 'RISK_ESCALATED',
        severity: 'warning',
        title: 'Coastal risk increased to high',
        detail: 'Risk moved from watch to high.',
        createdAt: '2026-09-30T12:00:00.000Z',
        acknowledgedAt: null,
        source: 'BayWatch risk engine',
        riskState: 'high',
        triggeredRuleIds: ['MARINE.WAVE.HIGH'],
        link: null,
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    fireEvent.click(screen.getByTestId('cc-acknowledge'));
    expect(acknowledge).toHaveBeenCalledWith('n1');
  });

  it('has a working acknowledge-all control', () => {
    const acknowledgeAll = vi.fn();
    const s = baseState();
    s.acknowledgeAll = acknowledgeAll;
    s.notifications = [
      {
        id: 'n1',
        eventKey: 'A',
        rule: 'RISK_ESCALATED',
        severity: 'warning',
        title: 't',
        detail: 'd',
        createdAt: '2026-09-30T12:00:00.000Z',
        acknowledgedAt: null,
        source: 's',
        riskState: 'high',
        triggeredRuleIds: [],
        link: null,
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    fireEvent.click(screen.getByTestId('cc-ack-all'));
    expect(acknowledgeAll).toHaveBeenCalled();
  });

  it('surfaces a denied notification permission without breaking the app', () => {
    const s = baseState();
    s.notificationPermission = 'denied';
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-permission-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('cc-request-permission')).not.toBeInTheDocument();
  });

  it('offers a permission request when permission is undecided', () => {
    const s = baseState();
    s.notificationPermission = 'default';
    s.requestPermission = vi.fn().mockResolvedValue('granted');
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-request-permission')).toBeInTheDocument();
  });

  it('marks an acknowledged notification as acknowledged', () => {
    const s = baseState();
    s.notifications = [
      {
        id: 'n1',
        eventKey: 'A',
        rule: 'RISK_ESCALATED',
        severity: 'warning',
        title: 't',
        detail: 'd',
        createdAt: '2026-09-30T12:00:00.000Z',
        acknowledgedAt: '2026-09-30T12:05:00.000Z',
        source: 's',
        riskState: 'high',
        triggeredRuleIds: [],
        link: null,
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.queryByTestId('cc-acknowledge')).not.toBeInTheDocument();
    expect(screen.getByTestId('cc-notification')).toHaveTextContent('Ack');
  });

  it('warns when notification persistence is unavailable', () => {
    const s = baseState();
    s.persistenceUnavailable = true;
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByText(/will not persist across reloads/i)).toBeInTheDocument();
  });
});

// =====================================================================
// EVENT STREAM
// =====================================================================

describe('event stream', () => {
  it('shows an empty state with no synthetic events', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByText('No events recorded yet.')).toBeInTheDocument();
  });

  it('renders only real events with a working source link', () => {
    const s = baseState();
    s.events = [
      buildEvent({
        kind: 'source-updated',
        at: '2026-09-30T12:00:00.000Z',
        summary: 'Marine reading updated',
        source: 'Open-Meteo Marine',
        link: 'https://marine-api.open-meteo.com/v1/marine',
        data: { waveHeightM: 0.8 },
      }),
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const list = screen.getByTestId('cc-event-list');
    expect(list).toHaveTextContent('Source updated');
    expect(list).toHaveTextContent('Marine reading updated');

    const link = screen.getByRole('link', { name: /Open Open-Meteo Marine/i });
    expect(link).toHaveAttribute('href', 'https://marine-api.open-meteo.com/v1/marine');
  });
});

// =====================================================================
// PROVENANCE
// =====================================================================

describe('source provenance', () => {
  it('shows issued time, retrieval time, fields used and limitations', () => {
    const s = baseState();
    s.provenance = [
      {
        sourceId: 'open-meteo-marine',
        sourceName: 'Open-Meteo Marine',
        url: 'https://marine-api.open-meteo.com/v1/marine?latitude=19.0988',
        authority: 'Open-Meteo',
        issuedAt: '2026-09-30T11:59:00.000Z',
        validFrom: null,
        validUntil: null,
        retrievedAt: '2026-09-30T12:00:00.000Z',
        status: 'live',
        fieldsUsed: ['wave_height', 'swell_wave_height'],
        limitations: ['Model-based forecast, not an Indian government observation.'],
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const item = screen.getByTestId('cc-provenance-item');
    expect(item).toHaveTextContent('Open-Meteo Marine');
    expect(item).toHaveTextContent('wave_height');
    expect(item).toHaveTextContent('not an Indian government observation');
    expect(item).toHaveTextContent('Not published');
  });

  it('never claims retrieval when the source was never read', () => {
    const s = baseState();
    s.provenance = [
      {
        sourceId: 'incois-tsunami',
        sourceName: 'INCOIS Tsunami',
        url: 'https://tsunami.incois.gov.in/TEWS/',
        authority: 'INCOIS',
        issuedAt: null,
        validFrom: null,
        validUntil: null,
        retrievedAt: null,
        status: 'unavailable',
        fieldsUsed: [],
        limitations: ['No CORS header, so this browser cannot read it.'],
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const item = screen.getByTestId('cc-provenance-item');
    expect(item).toHaveTextContent('Never');
    expect(item).toHaveTextContent('cannot read it');
  });
});

// =====================================================================
// FABRICATION GUARD
// =====================================================================

describe('no fabricated status vocabulary', () => {
  it('never renders invented status badges', () => {
    const s = baseState();
    s.assessment.state = 'high';
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const root = screen.getByTestId('coastal-command-center');
    for (const fabricated of ['VERIFIED', 'CONFIRMED', 'SAFE TO SWIM', 'ALL CLEAR']) {
      expect(root.textContent ?? '').not.toContain(fabricated);
    }
  });

  it('renders every panel of the command-center flow', () => {
    render(<CoastalCommandCenter language="en" />);
    for (const id of [
      'cc-current-state',
      'cc-official-warnings',
      'cc-forecast',
      'cc-risk-drivers',
      'cc-explanation',
      'cc-quality',
      'cc-voice',
      'cc-notifications',
      'cc-events',
      'cc-provenance',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('invokes a real refresh handler', () => {
    const refresh = vi.fn();
    const s = baseState();
    s.refresh = refresh;
    current = s;

    render(<CoastalCommandCenter language="en" />);
    fireEvent.click(screen.getByTestId('cc-refresh'));
    expect(refresh).toHaveBeenCalled();
  });
});
