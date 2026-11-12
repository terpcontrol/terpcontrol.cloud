import { type DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Liveness } from '@/screens/start/attention';
import { ageLabel, spokenAgo } from '@/ui/age';
import { Term } from '@/ui/Help';
import { Spoken } from '@/ui/Spoken';
import ui from '@/ui/ui.module.css';

/**
 * "online · vor 20 s" beside a place's name: the word is the state, the age
 * that of the newest reading. Once nothing has come for longer than a place
 * is called online or stale it is "offline · seit 42 Min", counted from the
 * newest figure the place produced: a shared or public reader is told the
 * tent and never what stands in it, so that figure is the one instant this
 * pill can honestly date.
 *
 * A place whose devices have sent nothing yet is `waiting` for its first
 * values, and says that rather than "offline". `explain` makes the word the
 * term that says what online and stale mean, on the one pill of a page that
 * does.
 */
export function LivenessPill({
  liveness,
  measuredAt,
  now,
  explain,
  waiting = false,
}: {
  liveness: Liveness;
  measuredAt: string | null;
  now: DateTime;
  explain?: boolean;
  waiting?: boolean;
}) {
  const { t } = useTranslation();
  if (liveness === 'none') return null;
  if (waiting) {
    return (
      <span className={ui.live} data-liveness="waiting">
        {t('liveness.waiting')}
      </span>
    );
  }
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
