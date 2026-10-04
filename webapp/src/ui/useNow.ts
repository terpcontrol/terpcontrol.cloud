import { type DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { onClockLearned, serverNow } from '@/api/clock';

/**
 * A clock that re-renders its caller on a beat, for every "20 s ago" on a
 * screen.
 *
 * It is the server's clock and not the browser's: the instants a screen ages
 * are the server's, so the subtraction has to be done on the same clock as the
 * one that stamped them. `serverNow` says how the two differ, and every screen
 * that draws an age reads it from here, which is what keeps them agreeing with
 * one another as well as with the server.
 *
 * The beat is the reason this is a hook at all, and the offset is the reason it
 * listens: the first answer of a session is what teaches the app the two clocks
 * differ, and a screen already drawn from the browser's clock should not go on
 * saying so until its next beat.
 */
export const useNow = (everyMs = 10_000): DateTime => {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), everyMs);
    const stopListening = onClockLearned(() => setNow(serverNow()));
    return () => {
      clearInterval(timer);
      stopListening();
    };
  }, [everyMs]);
  return now;
};
