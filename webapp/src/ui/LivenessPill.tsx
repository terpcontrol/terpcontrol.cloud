import { type DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Liveness } from '@/screens/start/attention';
import { ageLabel, spokenAgo } from '@/ui/age';
import { Term } from '@/ui/Help';
import { Spoken } from '@/ui/Spoken';
import ui from '@/ui/ui.module.css';

/**
 * "live · vor 20 s" beside a place's name: the word is the state, the age that
 * of the newest reading. Once nothing has come for longer than a place is
 * called live or stale it is "offline · seit 42 Min", counted from the newest
 * figure the place produced: a place is not one device, and a shared or public
 * reader is told the tent and never what stands in it, so that figure is the
 * one instant this pill can honestly date. The box under it says the hour.
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
  if (liveness === 'none') return null;
  const word = t(`home.reading.${liveness}`);
  const age = liveness === 'offline' ? 'liveness.since' : 'liveness.ago';

  return (
    <span className={ui.live} data-liveness={liveness}>
      {explain ? <Term topic="liveness">{word}</Term> : word}
      {measuredAt ? ' ' : null}
      {measuredAt ? (
        <Spoken said={`, ${t('spoken.newest', { ago: spokenAgo(measuredAt, now) })}`}>{`· ${t(age, { age: ageLabel(measuredAt, now) })}`}</Spoken>
      ) : null}
    </span>
  );
}
