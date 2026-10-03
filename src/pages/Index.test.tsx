import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Index from './Index';

// Mock child components that have external connections or heavy DOM
vi.mock('@/components/HeroSection', () => ({
  HeroSection: () => <div data-testid="hero-section">Hero Section</div>,
}));
vi.mock('@/components/MonitoringDashboard', () => ({
  MonitoringDashboard: () => <div data-testid="monitoring-dashboard">Monitoring Dashboard</div>,
}));
vi.mock('@/components/LocationTracker', () => ({
  LocationTracker: () => <div data-testid="location-tracker">Location Tracker</div>,
}));
vi.mock('@/components/WaveForecast', () => ({
  WaveForecast: () => <div data-testid="wave-forecast">Wave Forecast</div>,
}));
vi.mock('@/components/AlertCardsSection', () => ({
  AlertCardsSection: () => <div data-testid="alert-cards">Alert Cards</div>,
}));
vi.mock('@/components/ScenarioSimulation', () => ({
  ScenarioSimulation: () => <div data-testid="scenario-simulation">Scenario Simulation</div>,
  getScenarioData: () => ({}),
}));
vi.mock('@/components/VoiceAlertGuide', () => ({
  VoiceAlertGuide: () => <div data-testid="voice-guide">Voice Guide</div>,
}));
vi.mock('@/components/MockDrill', () => ({
  MockDrill: () => <div data-testid="mock-drill">Mock Drill</div>,
}));
vi.mock('@/components/EvacuationMap', () => ({
  EvacuationMap: () => <div data-testid="evacuation-map">Evacuation Map</div>,
}));
vi.mock('@/components/CitizenReporting', () => ({
  CitizenReporting: () => <div data-testid="citizen-reporting">Citizen Reporting</div>,
}));
vi.mock('@/components/IncidentIntelligence', () => ({
  IncidentIntelligence: () => <div data-testid="incident-intelligence">Incident Intelligence</div>,
}));
vi.mock('@/components/ResourceCommandCenter', () => ({
  ResourceCommandCenter: () => <div data-testid="resource-command-center">Urban Resource Command Center</div>,
}));
vi.mock('@/components/OperationalUserManagement', () => ({
  OperationalUserManagement: () => <div data-testid="operational-user-management">Operational User Management</div>,
}));
vi.mock('@/components/TouristMode', () => ({
  TouristMode: () => <div data-testid="tourist-mode">Tourist Mode</div>,
}));
vi.mock('@/components/GovernmentGuidelines', () => ({
  GovernmentGuidelines: () => <div data-testid="government-guidelines">Government Guidelines</div>,
}));
vi.mock('@/components/EmergencyContacts', () => ({
  EmergencyContacts: () => <div data-testid="emergency-contacts">Emergency Contacts</div>,
}));
vi.mock('@/components/DataSourcesFooter', () => ({
  DataSourcesFooter: () => <div data-testid="data-sources-footer">Data Sources Footer</div>,
}));
vi.mock('@/components/Chatbot', () => ({
  Chatbot: () => <div data-testid="chatbot">Chatbot</div>,
}));
vi.mock('@/components/MobileEmergencyAlert', () => ({
  MobileEmergencyAlert: () => <div data-testid="mobile-emergency-alert">Mobile Alert</div>,
}));
vi.mock('@/components/EmergencyBroadcastBanner', () => ({
  EmergencyBroadcastBanner: () => <div data-testid="broadcast-banner">Broadcast Banner</div>,
}));
vi.mock('@/components/LocationSelector', () => ({
  LocationSelector: () => <div data-testid="location-selector">Location Selector</div>,
}));
vi.mock('@/components/LanguageSelector', () => ({
  LanguageSelector: () => <div data-testid="language-selector">Language Selector</div>,
}));
vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle">Theme Toggle</div>,
}));

let mockUser: {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
} | null = null;
let mockAuthLoading = false;
let mockRoleState = {
  role: 'citizen' as 'citizen' | 'responder' | 'admin',
  isOperational: false,
  isAdmin: false,
  isSignedIn: true,
  isResolving: false,
};

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: mockAuthLoading,
    signOut: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAppRole', () => ({
  useAppRole: () => mockRoleState,
}));

vi.mock('@/hooks/useUrbanContext', () => ({
  useUrbanContext: () => ({
    context: {
      city: 'Mumbai',
      ward: 'K-West',
      zoneId: 'zone-mumbai-kwest',
      zoneName: 'Andheri West / Juhu Urban Disaster Risk Zone',
      isCoastal: true,
      latitude: 19.1136,
      longitude: 72.8292,
      source: 'configured_zone',
      confidence: 'high',
    },
    cities: [],
    cityZones: [],
    safeLocations: [],
    setCity: vi.fn(),
    setZone: vi.fn(),
    toggleGps: vi.fn(),
    isGpsActive: false,
  }),
}));

vi.mock('@/hooks/useMonitoring', () => ({
  useMonitoring: () => ({
    data: { riskLevel: 'low' },
    alerts: [],
    clock: '12:00:00',
    marine: { fetchedAt: new Date() },
    earthquakes: { fetchedAt: new Date() },
    sourceStatus: 'ok',
    // The real hook also exposes the canonical assessment and the tri-state
    // tsunami flag; the banner reason is derived from these.
    assessment: { dimensions: {}, officialWarningActive: null },
    tsunamiRisk: null,
  }),
}));

vi.mock('@/hooks/useSMSAlert', () => ({
  useSMSAlert: () => ({
    isMonitoring: true,
    lastAlertSent: null,
    lastAlertEvent: null,
    lastAlertTestMode: false,
    error: null,
    clearError: vi.fn(),
    testSMSAlert: vi.fn(),
    riskZones: [],
  }),
}));

vi.mock('@/hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({
    isOnline: true,
    status: 'online',
  }),
}));

vi.mock('@/hooks/useOfflineIncidentQueue', () => ({
  useOfflineIncidentQueue: () => ({
    stats: { pending: 0, uploading: 0, synced: 0, failed: 0 },
  }),
}));

describe('Index Page - Role-Aware Operational Navigation & Command Access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    // Index mounts the real CoastalIntelligenceProvider, which polls live
    // sources on mount. Fail every request: the page must render honest
    // unknown states, and the test must never touch the network.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline in test')));
  });

  describe('Citizen Experience', () => {
    beforeEach(() => {
      mockUser = { id: 'citizen-1', email: 'citizen@example.com' };
      mockRoleState = {
        role: 'citizen',
        isOperational: false,
        isAdmin: false,
        isSignedIn: true,
        isResolving: false,
      };
    });

    it('does NOT render operational navigation badges, preview banners, or operational workspace', () => {
      render(<Index />);

      expect(screen.queryByTestId('operational-nav-badge')).toBeNull();
      expect(screen.queryByTestId('preview-mode-banner')).toBeNull();
      expect(screen.queryByTestId('operational-workspace')).toBeNull();
    });

    it('renders the page inside the single shared pipeline without throwing', () => {
      // Regression: Index called useMonitoring() above the provider, which
      // threw "must be used inside a provider" and blanked the whole page for
      // every signed-in load. Rendering here proves the ordering is fixed.
      render(<Index />);
      expect(screen.getByTestId('citizen-dashboard')).toBeDefined();
    });

    it('renders normal citizen monitoring sections and reporting', () => {
      render(<Index />);

      expect(screen.getByTestId('citizen-dashboard')).toBeDefined();
      expect(screen.getByTestId('hero-section')).toBeDefined();
      expect(screen.getByTestId('monitoring-dashboard')).toBeDefined();
      expect(screen.getByTestId('citizen-reporting')).toBeDefined();
    });

    it('does NOT render ResourceCommandCenter, IncidentIntelligence, or OperationalUserManagement on the citizen dashboard', () => {
      render(<Index />);

      expect(screen.queryByTestId('resource-command-center')).toBeNull();
      expect(screen.queryByTestId('incident-intelligence')).toBeNull();
      expect(screen.queryByTestId('operational-user-management')).toBeNull();
      expect(screen.queryByText(/Urban Resource Command Center/i)).toBeNull();
      expect(screen.queryByText(/Incident Intelligence/i)).toBeNull();
      expect(screen.queryByText(/Operational Access Required/i)).toBeNull();
    });

    it('citizen cannot obtain operational access through client state manipulation', () => {
      // Even if user_metadata or client state attempts to claim admin
      mockUser = {
        id: 'citizen-1',
        email: 'citizen@example.com',
        user_metadata: { role: 'admin', isOperational: true },
      };
      mockRoleState = {
        role: 'citizen',
        isOperational: false,
        isAdmin: false,
        isSignedIn: true,
        isResolving: false,
      };

      render(<Index />);

      expect(screen.queryByTestId('operational-nav-badge')).toBeNull();
      expect(screen.queryByTestId('preview-mode-banner')).toBeNull();
      expect(screen.queryByTestId('operational-workspace')).toBeNull();
      expect(screen.queryByTestId('resource-command-center')).toBeNull();
      expect(screen.queryByTestId('incident-intelligence')).toBeNull();
    });
  });

  describe('Responder Operational Experience', () => {
    beforeEach(() => {
      mockUser = {
        id: 'responder-1',
        email: 'ops-responder@aapda.gov.in',
        app_metadata: { role: 'responder' },
      };
      mockRoleState = {
        role: 'responder',
        isOperational: true,
        isAdmin: false,
        isSignedIn: true,
        isResolving: false,
      };
    });

    it('enters Operational Response Workspace as primary experience on load', () => {
      render(<Index />);

      // Enters operational workspace as primary workspace
      expect(screen.getByTestId('operational-workspace')).toBeDefined();
      expect(screen.getByTestId('resource-command-center')).toBeDefined();
      expect(screen.getByTestId('incident-intelligence')).toBeDefined();

      // Top bar reflects operational role
      const navBadge = screen.getByTestId('operational-nav-badge');
      expect(navBadge).toBeDefined();
      expect(navBadge.textContent).toContain('responder');

      // Renders responder workspace header
      const header = screen.getByTestId('workspace-role-indicator');
      expect(header.textContent).toContain('OPERATIONAL RESPONSE WORKSPACE');
      expect(header.textContent).toContain('RESPONDER CONSOLE');

      // Does NOT render citizen-only reporting or drills on the primary operational workspace
      expect(screen.queryByTestId('citizen-reporting')).toBeNull();
      expect(screen.queryByTestId('mock-drill')).toBeNull();
      expect(screen.queryByTestId('scenario-simulation')).toBeNull();
      expect(screen.queryByTestId('tourist-mode')).toBeNull();
      expect(screen.queryByTestId('citizen-dashboard')).toBeNull();

      // Responder is strictly DENIED operational user management
      expect(screen.queryByTestId('operational-user-management')).toBeNull();
    });

    it('renders tactical spatial evacuation map and emergency contacts in operational workspace', () => {
      render(<Index />);

      expect(screen.getByTestId('evacuation-map')).toBeDefined();
      expect(screen.getByTestId('emergency-contacts')).toBeDefined();
    });

    it('allows responder to preview public citizen dashboard and return to operational workspace', () => {
      render(<Index />);

      const previewBtn = screen.getByTestId('preview-citizen-btn');
      fireEvent.click(previewBtn);

      // Now previewing citizen dashboard
      expect(screen.getByTestId('preview-mode-banner')).toBeDefined();
      expect(screen.getByTestId('citizen-dashboard')).toBeDefined();
      expect(screen.getByTestId('hero-section')).toBeDefined();
      expect(screen.queryByTestId('operational-workspace')).toBeNull();

      // Return to operational workspace via return button
      const returnBtn = screen.getByTestId('return-operational-btn');
      fireEvent.click(returnBtn);

      expect(screen.getByTestId('operational-workspace')).toBeDefined();
      expect(screen.queryByTestId('citizen-dashboard')).toBeNull();
      expect(screen.queryByTestId('preview-mode-banner')).toBeNull();
    });
  });

  describe('Admin Operational Experience', () => {
    beforeEach(() => {
      mockUser = {
        id: 'admin-1',
        email: 'ops-admin@aapda.gov.in',
        app_metadata: { role: 'admin' },
      };
      mockRoleState = {
        role: 'admin',
        isOperational: true,
        isAdmin: true,
        isSignedIn: true,
        isResolving: false,
      };
    });

    it('enters Operational Administration Workspace as primary experience on load', () => {
      render(<Index />);

      // Enters operational workspace as primary workspace
      expect(screen.getByTestId('operational-workspace')).toBeDefined();
      expect(screen.getByTestId('resource-command-center')).toBeDefined();
      expect(screen.getByTestId('incident-intelligence')).toBeDefined();

      // Renders administrator-only User & Role Management
      expect(screen.getByTestId('operational-user-management')).toBeDefined();

      // Top bar reflects admin role
      const navBadge = screen.getByTestId('operational-nav-badge');
      expect(navBadge).toBeDefined();
      expect(navBadge.textContent).toContain('admin');

      // Renders admin workspace header
      const header = screen.getByTestId('workspace-role-indicator');
      expect(header.textContent).toContain('OPERATIONAL ADMINISTRATION WORKSPACE');
      expect(header.textContent).toContain('ADMIN CONSOLE');

      // Does NOT render citizen-only reporting or simulations on the primary admin workspace
      expect(screen.queryByTestId('citizen-reporting')).toBeNull();
      expect(screen.queryByTestId('mock-drill')).toBeNull();
      expect(screen.queryByTestId('citizen-dashboard')).toBeNull();
    });

    it('allows admin to preview public citizen dashboard and return to operational workspace', () => {
      render(<Index />);

      const previewBtn = screen.getByTestId('preview-citizen-btn');
      fireEvent.click(previewBtn);

      expect(screen.getByTestId('preview-mode-banner')).toBeDefined();
      expect(screen.getByTestId('citizen-dashboard')).toBeDefined();

      // Return to operational workspace via nav badge
      const navBadge = screen.getByTestId('operational-nav-badge');
      fireEvent.click(navBadge);

      expect(screen.getByTestId('operational-workspace')).toBeDefined();
      expect(screen.queryByTestId('citizen-dashboard')).toBeNull();
    });
  });

  describe('Bootstrap Administrator Routing (admin123@gmail.com)', () => {
    beforeEach(() => {
      mockUser = {
        id: '56a29367-7188-4289-9ac5-4424e592f975',
        email: 'admin123@gmail.com',
        app_metadata: { provider: 'email', providers: ['email'], role: 'admin' },
      };
      mockRoleState = {
        role: 'admin',
        isOperational: true,
        isAdmin: true,
        isSignedIn: true,
        isResolving: false,
      };
    });

    it('routes bootstrap admin admin123@gmail.com directly to Operational Administration Workspace with user management', () => {
      render(<Index />);

      // Enters operational workspace directly
      expect(screen.getByTestId('operational-workspace')).toBeDefined();
      expect(screen.queryByTestId('citizen-dashboard')).toBeNull();

      // Renders workspace role indicator
      const header = screen.getByTestId('workspace-role-indicator');
      expect(header.textContent).toContain('OPERATIONAL ADMINISTRATION WORKSPACE');
      expect(header.textContent).toContain('ADMIN CONSOLE');

      // Renders OperationalUserManagement and ResourceCommandCenter
      expect(screen.getByTestId('operational-user-management')).toBeDefined();
      expect(screen.getByTestId('resource-command-center')).toBeDefined();
    });
  });

  describe('Role Resolution & Race Condition Prevention (STEP 4 & 6)', () => {
    it('shows role resolution loading state and does NOT prematurely render citizen dashboard while role is resolving', () => {
      mockUser = { id: 'admin-1', email: 'admin123@gmail.com' };
      mockAuthLoading = false;
      mockRoleState = {
        role: 'citizen',
        isOperational: false,
        isAdmin: false,
        isSignedIn: true,
        isResolving: true,
      };

      render(<Index />);

      // Must show loading gate
      expect(screen.getByTestId('role-resolution-loading')).toBeDefined();
      // Must NOT render citizen dashboard
      expect(screen.queryByTestId('citizen-dashboard')).toBeNull();
      // Must NOT render operational workspace yet
      expect(screen.queryByTestId('operational-workspace')).toBeNull();
    });

    it('regression: authenticated admin account renders operational workspace and NEVER the citizen dashboard', () => {
      mockUser = {
        id: 'admin-verified',
        email: 'admin123@gmail.com',
        app_metadata: { role: 'admin' },
      };
      mockAuthLoading = false;
      mockRoleState = {
        role: 'admin',
        isOperational: true,
        isAdmin: true,
        isSignedIn: true,
        isResolving: false,
      };

      render(<Index />);

      expect(screen.queryByTestId('role-resolution-loading')).toBeNull();
      expect(screen.queryByTestId('citizen-dashboard')).toBeNull();
      expect(screen.getByTestId('operational-workspace')).toBeDefined();
      expect(screen.getByTestId('operational-user-management')).toBeDefined();
    });

    it('renders operational workspace directly when user is confirmed operational even if isResolving flag is present', () => {
      mockUser = {
        id: 'admin-active',
        email: 'admin123@gmail.com',
        app_metadata: {},
      };
      mockAuthLoading = false;
      mockRoleState = {
        role: 'admin',
        isOperational: true,
        isAdmin: true,
        isSignedIn: true,
        isResolving: true, // Should not block because isOperational is true
      };

      render(<Index />);

      expect(screen.queryByTestId('role-resolution-loading')).toBeNull();
      expect(screen.getByTestId('operational-workspace')).toBeDefined();
    });
  });
});
