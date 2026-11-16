import { useEffect, useRef, useState } from 'react';
import type { LayoutSeen } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useDevicesShape } from '@/api/devices';
import { expectLayout, takeExpected, useSeeLayout } from '@/api/layers';
import { useMayManage } from '@/ui/session-access';
import { newsOf, useShape } from './shape';

/** What the shell has to say once: what came in, and whether the account is met for the first time with devices of its own. */
export interface LayoutNews {
  /** An account from before this layout: it has devices and was never shown a shape. */
  before: boolean;
  diary: boolean;
  places: boolean;
  count: number;
}

/**
 * What rearranges the app under a grower's thumb, said once and never as a
 * silent flip: the diary coming in, which puts Grow and the green Eintrag
 * button into the bar; a second place, which turns Start into a card per
 * place and puts the chosen place's name into the header; and, for an account
 * that was there before the app was laid out this way, the layout itself.
 *
 * The shape the account was last shown is kept with the account, so the line
 * comes once and not once per phone. An account without a shape on record is
 * recorded as it stands: one that already owns a device has used the app
 * before and is told where everything is now; a new one owns none when the
 * shell first sees it - a device is claimed inside the app - and is told
 * nothing, because nothing changed for it. What goes away - a place given up,
 * the diary switched off by its owner - is recorded without a word, because
 * the person did it. So is what the grower switched on a moment ago, on a
 * page that said what it does (`expectLayout`).
 *
 * The shell asks this on every page, also on one drawn without the bar, so
 * the account is recorded wherever it is first seen; the notice is drawn
 * above the pages that have the bar (`drawn`), and a shape with a line to
 * say is recorded only there: the question a claim asks is no place to have
 * read it, and a flow left on it is told on the next page with the bar.
 */
export const useLayoutNews = (drawn: boolean): [LayoutNews | null, () => void] => {
  const mayWrite = useMayManage();
  const me = useMe(false, mayWrite);
  const shape = useShape();
  const devices = useDevicesShape(mayWrite).data?.items;
  const see = useSeeLayout();
  const [news, setNews] = useState<LayoutNews | null>(null);
  const recorded = useRef<string | null>(null);

  const account = me.data;
  const { ready, diary, places } = shape;
  const { mutate } = see;

  useEffect(() => {
    if (!mayWrite || !ready || !account || !devices) return;
    const now: LayoutSeen = { diary, places: places > 1 };
    const seen = account.preferences.layoutSeen ?? null;
    const key = `${now.diary}:${now.places}`;
    if ((seen !== null && seen.diary === now.diary && seen.places === now.places) || recorded.current === key) return;

    // What the grower switched on a moment ago is recorded like any other change and not announced.
    const own = takeExpected();
    const came = newsOf(seen, now);
    const told: LayoutNews = {
      before: seen === null && devices.some(device => device.ownerId === account.id),
      diary: came !== null && came.diary && own.diary !== true,
      places: came !== null && came.places && own.places !== true,
      count: places,
    };
    // Not where the line cannot be drawn: the word about what was expected is kept for the page that draws it.
    if (!drawn && (told.before || told.diary || told.places)) return expectLayout(own);
    recorded.current = key;
    // Said whether or not the write lands: a server that did not keep it says it again next time, which is no worse.
    // A second place gone again while its line stands - ended on a page without the bar - takes the line along.
    const unsaid = (was: LayoutNews | null) => (was && !now.places ? (was.before || was.diary ? { ...was, places: false } : null) : was);
    mutate(now, { onSettled: () => setNews(told.before || told.diary || told.places ? told : unsaid) });
  }, [mayWrite, ready, account, devices, diary, places, mutate, drawn]);

  return [news, () => setNews(null)];
};
