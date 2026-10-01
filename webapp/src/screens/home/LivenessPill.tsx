import { type DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { ageLabel, offlineLabel } from '@/ui/age';
import { Term } from '@/ui/Help';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import type { Liveness } from './attention';

/**
 * "● live · 20 s" - the dot is the state, the age is the newest reading of the
 * place - and once nothing has come for longer than a place is called live or
 * stale, "● offline seit 10:19". That is the one term the banner, the cockpit
 * and the alert use for a silence as well, and it is dated rather than aged,
 * from the newest figure the place produced: a place is not one device, and a
 * shared or public reader is told the tent and never what stands in it, so the
 * newest figure is the one instant this pill can honestly date.
 *
 * `explain` makes the word the term that says what live and stale mean, on
 * the one pill of a page that does.
 */
export function LivenessPill({
  liveness,
  measuredAt,
  now,
  explain,
}: {
  liveness: Liveness;
  measuredAt: string | null;
  now: DateTime;
  explain?: boolean;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  if (liveness === 'none') return null;
  const offline = liveness === 'offline';
  const word = offline ? offlineLabel(measuredAt, now, zone) : t(`home.reading.${liveness}`);

  return (
    <span className={ui.live} data-liveness={liveness}>
      <span className={ui.liveDot} aria-hidden />
      {explain ? <Term topic="liveness">{word}</Term> : word}
      {measuredAt && !offline ? ` · ${ageLabel(measuredAt, now)}` : ''}
    </span>
  );
}
