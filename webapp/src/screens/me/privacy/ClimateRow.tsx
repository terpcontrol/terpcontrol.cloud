import { type DateTime } from 'luxon';
import { useState } from 'react';
import type { Me } from '@fg2/shared-types/v1';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/log/Sheet';
import ui from '@/ui/ui.module.css';
import { DAY } from '@/ui/zone';
import { Menu, Row } from '../parts';
import { cutoffDay, KEEP, narrows } from './climate';
import styles from './Privacy.module.css';

/**
 * How long raw climate points are kept, and the question that stands between
 * a shorter answer and the readings it throws away.
 *
 * Widening the window costs nothing and is sent as soon as it is chosen.
 * Narrowing it is the other irreversible control on this screen: the sweep
 * summarises every day outside the window to one figure and deletes the raw
 * points for good, and a one-tap menu whose line reads "raw samples · then
 * daily summaries" does not say that to a beginner. So a narrower choice opens
 * a sheet first that names what goes and from when, and the account is only
 * written once that has been read and answered. The menu is controlled by what
 * the account holds, so a sheet that is put away leaves the menu where it was.
 *
 * "Keep everything" is `null`, which the server reads as nothing said and
 * hands on to the install's own setting; it is never narrower than a number,
 * so choosing it is never asked about.
 */
export function ClimateRow({
  climateDays,
  retention,
  disabled,
  now,
  onChange,
}: {
  climateDays: number | null;
  retention: Me['climateRetention'];
  disabled: boolean;
  now: DateTime;
  onChange: (days: number | null) => void;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState<number | null>(null);

  const choose = (value: string) => {
    const days = value === '' ? null : Number(value);
    if (narrows(climateDays, days)) setAsking(days);
    else onChange(days);
  };

  return (
    <>
      {/*
        "Keep everything" is the account saying nothing, and an install may have
        a window of its own behind that - so the line says what will really
        happen here rather than repeating the choice back.
      */}
      <Row
        title={t('me.privacy.climate.title')}
        line={
          retention.appliesDays === null
            ? t('me.privacy.climate.line')
            : climateDays === null
              ? t('me.privacy.climate.installKeeps', { count: retention.appliesDays })
              : t('me.privacy.climate.line')
        }
      >
        <Menu name={t('me.privacy.climate.title')} value={String(climateDays ?? '')} disabled={disabled} onChange={choose}>
          {KEEP.map(option => (
            <option key={option.key} value={option.days === null ? '' : String(option.days)}>
              {t(`me.privacy.keep.${option.key}`)}
            </option>
          ))}
        </Menu>
      </Row>
      {asking !== null ? (
        <ClimateSheet
          days={asking}
          now={now}
          onClose={() => setAsking(null)}
          onKeep={() => {
            onChange(asking);
            setAsking(null);
          }}
        />
      ) : null}
    </>
  );
}

/** The question: what a shorter window does, in the menu's own words for the window and a date for where it cuts. */
function ClimateSheet({ days, now, onClose, onKeep }: { days: number; now: DateTime; onClose: () => void; onKeep: () => void }) {
  const { t, i18n } = useTranslation();
  const option = KEEP.find(candidate => candidate.days === days);
  const keep = option ? t(`me.privacy.keep.${option.key}`) : t('me.door.privacy.days', { count: days });
  // The cutoff is worked out in UTC because that is where the server cuts, so
  // only the shape is decided here: the app's one date shape rather than
  // Luxon's medium preset, which followed the language into "Oct 23, 2026".
  const date = cutoffDay(days, now).setLocale(i18n.language).toFormat(DAY);

  return (
    <Sheet
      title={t('me.privacy.climate.title')}
      aside={keep}
      onClose={onClose}
      actions={
        <button type="button" className={`${ui.button} ${styles.dangerButton}`} onClick={onKeep}>
          {t('me.privacy.climate.ask.yes', { keep })}
        </button>
      }
    >
      <p className={styles.sheetBody}>{t('me.privacy.climate.ask.what', { keep, date })}</p>
    </Sheet>
  );
}
