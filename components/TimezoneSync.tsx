'use client';

import { useEffect } from 'react';
import { updateUserTimezoneIfChangedAction } from '@/app/actions/settings';

export function TimezoneSync() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        void updateUserTimezoneIfChangedAction(tz).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, []);
  return null;
}
