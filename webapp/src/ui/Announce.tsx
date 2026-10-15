import { useEffect } from 'react';
import { announce } from './live-region';

/** Says `text` through the app's one live region each time it changes to something; nothing is drawn. */
export function Announce({ text }: { text: string | null | false | undefined }) {
  useEffect(() => {
    if (text) announce(text);
  }, [text]);
  return null;
}
