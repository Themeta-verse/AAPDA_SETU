import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocationSelector } from './LocationSelector';
import { EvacuationMap } from './EvacuationMap';
import { DEFAULT_URBAN_ZONES } from '@/lib/urbanContext';

describe('LocationSelector and EvacuationMap Urbanization', () => {
  it('renders city, ward, and zone dropdowns with configured data', () => {
    const onCityChange = vi.fn();
    const onZoneChange = vi.fn();
    const onToggleGps = vi.fn();

    const mockContext = {
      city: 'Mumbai',
      ward: 'K-West',
      zoneId: 'zone-mumbai-juhu',
      zoneName: 'Juhu Beach Flood Risk Zone',
      isCoastal: true,
      zoneType: 'coastal' as const,
      latitude: 19.0988,
      longitude: 72.8267,
      source: 'configured_zone' as const,
      confidence: 'configured' as const,
    };

    render(
      <LocationSelector
        context={mockContext}
        cities={[
          { id: 'mumbai', name: 'Mumbai', state: 'Maharashtra', defaultLat: 19.076, defaultLon: 72.8777, isCoastal: true },
          { id: 'pune', name: 'Pune', state: 'Maharashtra', defaultLat: 18.5204, defaultLon: 73.8567, isCoastal: false },
        ]}
        cityZones={DEFAULT_URBAN_ZONES.filter(z => z.city === 'Mumbai')}
        isGpsActive={false}
        onSelectCity={onCityChange}
        onSelectZone={onZoneChange}
        onToggleGps={onToggleGps}
      />
    );

    // Dropdowns are present
    const citySelect = screen.getByLabelText('Select City');
    expect(citySelect).toBeDefined();
    expect((citySelect as HTMLSelectElement).value).toBe('Mumbai');

    const zoneSelect = screen.getByLabelText('Select Ward / Risk Zone');
    expect(zoneSelect).toBeDefined();
    expect((zoneSelect as HTMLSelectElement).value).toBe('zone-mumbai-juhu');

    // Changing city triggers onSelectCity
    fireEvent.change(citySelect, { target: { value: 'Pune' } });
    expect(onCityChange).toHaveBeenCalledWith('Pune');

    // Clicking GPS button triggers onToggleGps
    const gpsBtn = screen.getByTestId('toggle-gps');
    fireEvent.click(gpsBtn);
    expect(onToggleGps).toHaveBeenCalled();
  });

  it('EvacuationMap renders honest empty state when no safe locations exist', () => {
    render(
      <EvacuationMap
        language="en"
        zoneName="Empty Test Zone"
        cityName="EmptyCity"
        wardName="Ward Zero"
        centerLat={20.000}
        centerLon={75.000}
        isCoastal={false}
        safeLocations={[]}
      />
    );

    expect(screen.getByText('No configured evacuation locations for this area.')).toBeDefined();
    expect(screen.getAllByText(/Empty Test Zone/i)[0]).toBeDefined();
  });

  it('EvacuationMap renders verified safe locations when configured', () => {
    const mockSafe = [
      {
        id: 'safe-1',
        name: 'Municipal Community Hall',
        locationType: 'shelter' as const,
        city: 'Mumbai',
        zoneId: 'zone-sion-flood',
        latitude: 19.0400,
        longitude: 72.8600,
        capacity: 400,
        address: 'Sion Circle, Mumbai',
        contactNumber: '112',
        isActive: true,
      },
    ];

    render(
      <EvacuationMap
        language="en"
        zoneName="Sion Waterlogging Basin"
        cityName="Mumbai"
        wardName="F-North"
        centerLat={19.0430}
        centerLon={72.8625}
        isCoastal={false}
        safeLocations={mockSafe}
      />
    );

    expect(screen.getByText('Municipal Community Hall')).toBeDefined();
    expect(screen.getByText('Sion Circle, Mumbai')).toBeDefined();
    expect(screen.getByText('400')).toBeDefined();
    expect(screen.getByText('Operational')).toBeDefined();
  });
});
