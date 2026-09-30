import { useState, useEffect, useCallback } from 'react';

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

interface NetworkStatusState {
  status: ConnectionStatus;
  isOnline: boolean;
  lastOnlineAt: Date | null;
  lastOfflineAt: Date | null;
}

export function useNetworkStatus() {
  const [state, setState] = useState<NetworkStatusState>(() => {
    if (typeof navigator === 'undefined') {
      return {
        status: 'offline',
        isOnline: false,
        lastOnlineAt: null,
        lastOfflineAt: null,
      };
    }
    return {
      status: navigator.onLine ? 'online' : 'offline',
      isOnline: navigator.onLine,
      lastOnlineAt: navigator.onLine ? new Date() : null,
      lastOfflineAt: navigator.onLine ? null : new Date(),
    };
  });

  const handleOnline = useCallback(() => {
    setState(prev => ({
      ...prev,
      status: 'reconnecting',
      isOnline: true,
      lastOnlineAt: new Date(),
    }));

    setTimeout(() => {
      setState(prev => ({
        ...prev,
        status: 'online',
      }));
    }, 1000);
  }, []);

  const handleOffline = useCallback(() => {
    setState(prev => ({
      ...prev,
      status: 'offline',
      isOnline: false,
      lastOfflineAt: new Date(),
    }));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return state;
}