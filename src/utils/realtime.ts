import { useEffect } from 'react';

export type RefreshReason = 'interval' | 'focus' | 'visibility' | 'action' | 'storage' | 'event' | 'initial';

export const REFRESH_EVENT = 'pda:refresh';

export const notifyAppRefresh = (reason: RefreshReason = 'action', detail?: Record<string, unknown>) => {
  if (typeof window === 'undefined') return;

  const payload = {
    reason,
    timestamp: Date.now(),
    ...detail,
  };

  window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail: payload }));

  try {
    window.localStorage.setItem(REFRESH_EVENT, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
};

export const useAppRefresh = (callback: (reason: RefreshReason) => void, intervalMs = 10000) => {
  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: RefreshReason }>).detail;
      callback(detail?.reason ?? 'event');
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        callback('visibility');
      }
    };

    const handleFocus = () => {
      callback('focus');
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === REFRESH_EVENT && event.newValue) {
        try {
          const payload = JSON.parse(event.newValue) as { reason?: RefreshReason };
          callback(payload.reason ?? 'storage');
        } catch {
          callback('storage');
        }
      }
    };

    const intervalId = window.setInterval(() => {
      callback('interval');
    }, intervalMs);

    window.addEventListener(REFRESH_EVENT, handleRefresh as EventListener);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(REFRESH_EVENT, handleRefresh as EventListener);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, [callback, intervalMs]);
};
