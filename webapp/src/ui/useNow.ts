import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';

/** A clock that re-renders its caller on a beat, for every "20 s ago" on a screen. */
export const useNow = (everyMs = 10_000): DateTime => {
  const [now, setNow] = useState(() => DateTime.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(DateTime.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
};
