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
//
// The component reads the shared provider state rather than calling the hook
// itself, so the provider module is what must be mocked. Mocking the hook here
// would be wrong: it would let a component quietly start a second polling
// pipeline, which is the exact regression these tests now guard against.
vi.mock('@/hooks/CoastalIntelligenceProvider', () => ({
  useSharedCoastalIntelligence: () => mockState(),
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
    // No forecast hours means no outlook can be projected, which is the honest
    // default for a state that has not been populated yet.
    outlook: {
      peakState: null,
      peakAt: null,
      trend: 'unknown',
      windows: [],
      hoursAssessed: 0,
      hoursExpected: 48,
      coverage: 'none',
      coverageNote: 'No forecast hours were published, so no outlook can be projected.',
      limitations: [],
    },
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
    isFetching: false,
    rateLimitedUntil: null,
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

  it('shows a probing state rather than "no warnings" before any attempt', () => {
    // Nothing has been tried yet, so a spinner is the only honest thing to show.
    const s = baseState();
    s.fetchState = {
      ...s.fetchState,
      warnings: {
        status: 'unavailable',
        lastSuccessfulFetch: null,
        lastAttemptedFetch: null,
        nextRefreshAt: null,
        errorKind: null,
        errorMessage: null,
      },
    };
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByText(/Probing official sources/i)).toBeInTheDocument();
  });

  it('does not spin forever after a failed attempt', () => {
    // Regression: an empty product list was rendered as a permanent
    // "Probing official sources…" spinner, so an unreachable retriever looked
    // like a hung request instead of an honest failure.
    const s = baseState();
    s.officialWarnings = [];
    s.fetchState = {
      ...s.fetchState,
      warnings: {
        status: 'unavailable',
        lastSuccessfulFetch: null,
        lastAttemptedFetch: '2026-09-30T11:58:00.000Z',
        nextRefreshAt: null,
        errorKind: 'unreachable',
        errorMessage:
          'The server-side warning retriever could not be reached, so IMD and INCOIS status is ' +
          'UNKNOWN. This is not an all-clear.',
      },
    };
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.queryByText(/Probing official sources/i)).not.toBeInTheDocument();
    const notice = screen.getByTestId('cc-warning-unreachable');
    expect(notice).toHaveTextContent('UNKNOWN');
    expect(notice).toHaveTextContent('not an all-clear');
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
    // Severity now comes from the shared engine rule table, where
    // MARINE.WAVE.HIGH is `high` — never `severe`, which needs an authority.
    hazardState: wave !== null && wave >= 3.7 ? ('high' as const) : ('nominal' as const),
    ruleIds: wave !== null && wave >= 3.7 ? ['MARINE.WAVE.HIGH'] : [],
    sourceStatus: 'live' as const,
  });

  it('shows an explicit empty state with no invented hours', () => {
    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-forecast-empty')).toBeInTheDocument();
  });

  it('reports the real published-hour count against the 48-hour horizon', () => {
    const s = baseState();
    s.forecast = [point('2026-09-30T13:00:00.000Z', 1.2), point('2026-09-30T14:00:00.000Z', 1.3)];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-forecast-horizon')).toHaveTextContent('2 of 48 hours published');
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

  it('selects the first published hour by default so the panel is never empty', () => {
    const s = baseState();
    s.forecast = [point('2026-09-30T14:00:00.000Z', 3.9)];
    current = s;

    render(<CoastalCommandCenter language="en" />);

    const detail = screen.getByTestId('cc-forecast-detail');
    expect(detail).toHaveTextContent('MARINE.WAVE.HIGH');
    expect(screen.getByTestId('cc-forecast-point')).toHaveAttribute('aria-pressed', 'true');
  });

  it('moves the selection when a different hour is clicked', () => {
    const s = baseState();
    s.forecast = [
      point('2026-09-30T13:00:00.000Z', 1.2),
      point('2026-09-30T14:00:00.000Z', 3.9),
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const chips = screen.getAllByTestId('cc-forecast-point');
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(chips[1]);
    expect(screen.getAllByTestId('cc-forecast-point')[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('labels a source-locked forecast hour as having no data', () => {
    const s = baseState();
    s.forecast = [
      { ...point('2026-09-30T14:00:00.000Z', null), hazardState: 'insufficient-data' as const },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-forecast-point')).toHaveTextContent('no data');
    expect(screen.getByTestId('cc-forecast-detail')).toHaveTextContent(
      'no hazard claim is made'
    );
  });

  it('shows a loading state instead of a fake empty state while fetching', () => {
    const s = baseState();
    s.forecast = [];
    s.isFetching = true;
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-forecast-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('cc-forecast-empty')).not.toBeInTheDocument();
  });

  it('explains a real HTTP 429 rather than implying no forecast exists', () => {
    const s = baseState();
    s.forecast = [];
    s.isFetching = false;
    s.rateLimitedUntil = '2026-09-30T12:05:00.000Z';
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-forecast-ratelimited')).toHaveTextContent('HTTP 429');
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
    // A recovery is a real transition. A `source-updated` heartbeat is not, and
    // the event stream deliberately no longer emits one per poll.
    s.events = [
      buildEvent({
        kind: 'source-recovered',
        at: '2026-09-30T12:00:00.000Z',
        summary: 'Open-Meteo Marine is serving readings again',
        source: 'Open-Meteo Marine',
        link: 'https://marine-api.open-meteo.com/v1/marine',
        data: { waveHeightM: 0.8 },
      }),
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const list = screen.getByTestId('cc-event-list');
    expect(list).toHaveTextContent('Source recovered');
    expect(list).toHaveTextContent('Open-Meteo Marine is serving readings again');

    const link = screen.getByRole('link', { name: /Open Open-Meteo Marine/i });
    expect(link).toHaveAttribute('href', 'https://marine-api.open-meteo.com/v1/marine');
  });

  it('does not render a source-updated heartbeat entry', () => {
    // If a heartbeat kind ever reappears, the event stream has regressed back to
    // logging polls instead of transitions.
    const s = baseState();
    s.events = [
      buildEvent({
        kind: 'source-recovered' as never,
        at: '2026-09-30T12:00:00.000Z',
        summary: 'Reading refreshed',
        source: 'Open-Meteo Marine',
      }),
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-event-list')).not.toHaveTextContent('Source updated');
  });
});

// =====================================================================
// DERIVED OUTLOOK
// =====================================================================

describe('48-hour outlook', () => {
  const NONE_HOUR = {
    waveHeightM: null,
    swellHeightM: null,
    wavePeriodS: null,
    windSpeedKmh: null,
    windGustKmh: null,
    precipitationMm: null,
    precipitationProbabilityPct: null,
    visibilityM: null,
  };

  function withOutlook(overrides: Record<string, unknown>) {
    return baseState(overrides as never);
  }

  it('is explicitly unknown when no forecast data exists', () => {
    // "No outlook" must never be rendered as a calm outlook.
    const s = withOutlook({});
    render(<CoastalCommandCenter language="en" />);

    expect(screen.getByTestId('cc-outlook-unknown')).toHaveTextContent(
      'not an indication of calm',
    );
  });

  it('reports peak, trend and coverage when the horizon has data', () => {
    const s = withOutlook({
      outlook: {
        peakState: 'high',
        peakAt: '2026-09-30T18:00:00.000Z',
        trend: 'worsening',
        windows: [],
        hoursAssessed: 48,
        hoursExpected: 48,
        coverage: 'complete',
        coverageNote: 'All 48 of 48 forecast hours carried usable data.',
        limitations: ['Not a machine-learning prediction.'],
      },
    });
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-outlook-peak')).toHaveTextContent('High');
    expect(screen.getByTestId('cc-outlook-trend')).toHaveTextContent('Worsening');
    expect(screen.getByTestId('cc-outlook-coverage')).toHaveTextContent('48/48');
  });

  it('explains each elevated window with the rule that actually drove it', () => {
    // The panel used to always attribute a peak to wave height whenever one was
    // present, which misattributed the cause when a different rule had fired.
    const s = withOutlook({
      outlook: {
        peakState: 'elevated',
        peakAt: '2026-09-30T20:00:00.000Z',
        trend: 'stable',
        windows: [
          {
            from: '2026-09-30T18:00:00.000Z',
            to: '2026-09-30T21:00:00.000Z',
            state: 'elevated',
            hours: 4,
            basis: {
              at: '2026-09-30T20:00:00.000Z',
              ruleIds: ['WEATHER.VISIBILITY.LOW'],
              triggers: [
                {
                  ruleId: 'WEATHER.VISIBILITY.LOW',
                  basis: 'Visibility below 4 km',
                  observed: [3200],
                },
              ],
              values: { ...NONE_HOUR, waveHeightM: 0.56, visibilityM: 3200 },
            },
          },
        ],
        hoursAssessed: 48,
        hoursExpected: 48,
        coverage: 'complete',
        coverageNote: 'All 48 hours assessed.',
        limitations: [],
      },
    });
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const windows = screen.getByTestId('cc-outlook-windows');
    // Names the real trigger and the value it inspected.
    expect(windows).toHaveTextContent('WEATHER.VISIBILITY.LOW');
    expect(windows).toHaveTextContent('3200');
    // And does NOT claim a wave of 0.56 m caused it.
    expect(windows).not.toHaveTextContent('wave height 0.56');
  });

  it('states partial coverage rather than implying a full projection', () => {
    const s = withOutlook({
      outlook: {
        peakState: 'nominal',
        peakAt: null,
        trend: 'unknown',
        windows: [],
        hoursAssessed: 6,
        hoursExpected: 48,
        coverage: 'partial',
        coverageNote: '6 of 48 forecast hours carried usable data.',
        limitations: [],
      },
    });
    current = s;

    render(<CoastalCommandCenter language="en" />);
    expect(screen.getByTestId('cc-outlook-coverage')).toHaveTextContent('6/48');
  });

  it('always offers the limitations rather than only on request', () => {
    const s = withOutlook({
      outlook: {
        peakState: 'nominal',
        peakAt: null,
        trend: 'stable',
        windows: [],
        hoursAssessed: 48,
        hoursExpected: 48,
        coverage: 'complete',
        coverageNote: 'All hours assessed.',
        limitations: ['Model error grows with lead time.'],
      },
    });
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const panel = screen.getByTestId('cc-outlook');
    expect(panel).toHaveTextContent('Rule-based derivation');
    expect(panel).toHaveTextContent('Model error grows with lead time.');
  });
});

// =====================================================================
// PROVENANCE
// =====================================================================

describe('source provenance', () => {
  it('is collapsed by default so metadata does not dominate the dashboard', () => {
    // Provenance previously rendered as a full-height stack of expanded cards,
    // occupying more space than the entire operational dashboard above it.
    const s = baseState();
    s.provenance = [
      {
        sourceId: 'open-meteo-marine',
        sourceName: 'Open-Meteo Marine',
        url: 'https://marine-api.open-meteo.com/v1/marine',
        authority: 'Open-Meteo',
        issuedAt: '2026-09-30T11:59:00.000Z',
        validFrom: null,
        validUntil: null,
        retrievedAt: '2026-09-30T12:00:00.000Z',
        status: 'live',
        fieldsUsed: ['wave_height'],
        limitations: ['Model-based forecast.'],
      },
    ];
    current = s;

    render(<CoastalCommandCenter language="en" />);

    const details = screen.getByTestId('cc-provenance-details');
    // Not expanded on first render.
    expect(details).not.toHaveAttribute('open');
  });

  it('states source availability without needing to expand anything', () => {
    // The reader must learn "IMD is unreadable" at a glance, not by opening it.
    const s = baseState();
    s.provenance = [
      {
        sourceId: 'open-meteo-marine',
        sourceName: 'Open-Meteo Marine',
        url: 'https://marine-api.open-meteo.com/v1/marine',
        authority: 'Open-Meteo',
        issuedAt: null,
        validFrom: null,
        validUntil: null,
        retrievedAt: '2026-09-30T12:00:00.000Z',
        status: 'live',
        fieldsUsed: [],
        limitations: [],
      },
      {
        sourceId: 'imd-marine-forecast',
        sourceName: 'IMD Marine Forecast',
        url: 'https://mausam.imd.gov.in/responsive/marine_forecast.php',
        authority: 'IMD',
        issuedAt: null,
        validFrom: null,
        validUntil: null,
        retrievedAt: '2026-09-30T12:00:00.000Z',
        status: 'unavailable',
        blocker: 'no-bulletin-content',
        blockerDetail: 'navigation chrome only',
        httpStatus: 200,
        contentType: 'text/html',
        fieldsUsed: [],
        limitations: [],
      },
    ] as never;
    current = s;

    render(<CoastalCommandCenter language="en" />);

    const summary = screen.getByTestId('cc-provenance-summary');
    expect(summary).toHaveTextContent('2 sources');
    expect(summary).toHaveTextContent('1 operational');
    expect(summary).toHaveTextContent('1 unreadable');

    // Grouped, and the failing source is named without expanding.
    const section = screen.getByTestId('cc-provenance');
    expect(section).toHaveTextContent('Official warnings');
    expect(section).toHaveTextContent('IMD Marine Forecast');
  });

  it('warns that dependent values are unknown rather than safe', () => {
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
        limitations: [],
      },
    ] as never;
    current = s;

    render(<CoastalCommandCenter language="en" />);
    const section = screen.getByTestId('cc-provenance');
    expect(section).toHaveTextContent('shown as unknown, not as safe');
  });

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
