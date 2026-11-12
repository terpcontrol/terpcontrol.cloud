import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowthStage } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useGrows } from '@/api/grows';
import { DAY_MS, dayOf, momentOn } from '@/ui/days';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import { growBody, START_STAGES, suggestedName } from './new-grow';
import { useStartGrow } from './start-grow';
import styles from './NewGrow.module.css';

type Since = 'today' | 'week' | 'date';

/**
 * "Was wächst hier?" - the four answers a diary needs to begin in a place that
 * already stands: what it is, since when, how many, and the phase it is in.
 * Everything else the full sheet asks has an answer that can wait - a feeding
 * scheme, the strains by name - and is changed on the grow's own page.
 *
 * It records the grow and its phase and nothing more: the place's climate is
 * what its device was set to, here as before, and Steuerung is where it is
 * changed. So the stages are named plainly, and nothing in a running tent
 * moves because somebody said what is growing in it.
 *
 * It opens on the stage the place is on (`stage`) and follows it until one is
 * picked - the caller reads it off the device, which may answer after the
 * form is drawn. Where nothing says, it opens on growth: a tent that already
 * regulates rarely holds seeds, and a form that opened on germination wrote
 * "Keimung" over many a flowering tent whose grower only typed a name.
 */
export function WhatGrows({
  spaceId,
  stage: given = null,
  onStarting,
  onStarted,
  submitClass,
}: {
  spaceId: string;
  /** The stage the place is on, which is the one the plants are most likely in; null or absent where nothing says. */
  stage?: GrowthStage | null;
  /** The form was sent: from here on the grow may exist, whatever the page around the form reads next. */
  onStarting?: () => void;
  onStarted: (growId: string) => void;
  submitClass?: string;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const grows = useGrows();
  const { start, busy, refused } = useStartGrow(spaceId);
  const [name, setName] = useState('');
  const [since, setSince] = useState<Since>('today');
  const [date, setDate] = useState(() => serverNow().toJSDate());
  const [count, setCount] = useState(1);
  const [picked, setStage] = useState<GrowthStage | null>(null);
  const stage: GrowthStage = picked ?? (given && START_STAGES.includes(given) ? given : 'vegetative');

  const submit = async () => {
    const now = serverNow().toJSDate();
    const startedAt = since === 'today' ? now : since === 'week' ? new Date(now.getTime() - 7 * DAY_MS) : date;
    const typed = name.trim();
    const body = growBody(
      { name: typed, plants: [{ key: '1', strain: typed, count }], type: 'photoperiod', spaceId, stage, startedAt, schemeId: null },
      typed || suggestedName(grows.data?.items ?? [], spaceId, t('grow.new.firstName')),
      null,
      t('grow.new.unnamedStrain'),
    );
    onStarting?.();
    try {
      onStarted(await start({ body, stage, startedAt }));
    } catch {
      // The refusal is drawn under the fields; what already stands is not written again on the next tap.
    }
  };

  return (
    <form
      className={styles.whatGrows}
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className={styles.field}>
        {t('start.grow.name')}
        <input className={ui.input} value={name} autoComplete="off" onChange={event => setName(event.target.value)} />
      </label>
      <div className={styles.fieldPair}>
        <label className={styles.field}>
          {t('start.grow.since')}
          <select className={ui.input} value={since} onChange={event => setSince(event.target.value as Since)}>
            <option value="today">{t('start.grow.today')}</option>
            <option value="week">{t('start.grow.week')}</option>
            <option value="date">{t('start.grow.date')}</option>
          </select>
        </label>
        <label className={styles.field}>
          {t('grow.new.plants')}
          <input
            className={ui.input}
            type="number"
            inputMode="numeric"
            min={1}
            value={count}
            onChange={event => setCount(Math.max(1, Math.round(Number(event.target.value)) || 1))}
          />
        </label>
      </div>
      {since === 'date' ? (
        <label className={styles.field}>
          {t('grow.new.startedOn')}
          <input
            className={ui.input}
            type="date"
            max={dayOf(serverNow().toJSDate(), zone)}
            value={dayOf(date, zone)}
            onChange={event => event.target.value && setDate(momentOn(event.target.value, date, zone))}
          />
        </label>
      ) : null}
      <div className={`${ui.segments} ${ui.segmentsFill}`} role="group" aria-label={t('home.entryKind.phase')}>
        {START_STAGES.map(one => (
          <button key={one} type="button" className={ui.segment} aria-pressed={stage === one} onClick={() => setStage(one)}>
            {t(`home.stage.${one}`)}
          </button>
        ))}
      </div>
      <Refused error={refused} />
      <button type="submit" className={submitClass ?? `${ui.button} ${ui.primary}`} disabled={busy || grows.isPending}>
        {busy ? t('grow.new.starting') : t('home.invite.startGrow')}
      </button>
    </form>
  );
}
