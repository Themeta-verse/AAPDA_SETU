import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGeolocation } from './useGeolocation';

/**
 * GPS failure modes are distinct problems with distinct remedies, so the hook
 * must distinguish them — and must NEVER substitute a fallback position. No
 * fix means `position` stays null, full stop.
 */

function mockGeolocation(impl: Partial<Geolocation>) {
  Object.defineProperty(window.navigator, 'geolocation', {
    value: impl,
    configurable: true,
    writable: true,
  });
}

describe('useGeolocation honesty', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('reports unsupported when the API does not exist and invents no position', () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.requestLocation();
    });
    expect(result.current.status).toBe('unsupported');
    expect(result.current.position).toBeNull();
    expect(result.current.formatted).toBeNull();
  });

  it('stores a real fix with real accuracy', async () => {
    mockGeolocation({
      getCurrentPosition: ((_success: PositionCallback) => {
        _success({
          coords: {
            latitude: 19.11,
            longitude: 72.83,
            accuracy: 18,
          } as GeolocationCoordinates,
          timestamp: Date.now(),
        } as GeolocationPosition);
      }) as typeof navigator.geolocation.getCurrentPosition,
      watchPosition: vi.fn().mockReturnValue(7),
      clearWatch: vi.fn(),
    } as Geolocation);
    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.requestLocation();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.position).toEqual({ latitude: 19.11, longitude: 72.83 });
    expect(result.current.accuracyM).toBe(18);
    expect(result.current.formatted).toContain('19.11');
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('maps error code %i to status %s with no fallback position', async (code, status) => {
    mockGeolocation({
      getCurrentPosition: ((_s: PositionCallback, error?: PositionErrorCallback) => {
        // The hook distinguishes modes via the numeric constants on the
        // error object, exactly like a real browser does.
        error?.({
          code,
          message: 'x',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError);
      }) as typeof navigator.geolocation.getCurrentPosition,
      watchPosition: vi.fn().mockReturnValue(1),
      clearWatch: vi.fn(),
    } as Geolocation);
    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.requestLocation();
    });
    await waitFor(() => expect(result.current.status).toBe(status));
    expect(result.current.position).toBeNull();
  });

  it('rejects a non-finite fix instead of propagating NaN into distances', async () => {
    mockGeolocation({
      getCurrentPosition: ((_success: PositionCallback) => {
        _success({
          coords: { latitude: NaN, longitude: 72.83, accuracy: 10 } as GeolocationCoordinates,
          timestamp: Date.now(),
        } as GeolocationPosition);
      }) as typeof navigator.geolocation.getCurrentPosition,
      watchPosition: vi.fn().mockReturnValue(1),
      clearWatch: vi.fn(),
    } as Geolocation);
    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.requestLocation();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.position).toBeNull();
  });
});
