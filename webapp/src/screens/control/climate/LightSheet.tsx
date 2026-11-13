import type { DateTime } from 'luxon';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { shapeOf, type Field, type NowHolding, type Shape } from '../targets/day-night';
import { LightPlan } from '../targets/LightPlan';
import type { LightSchedule, TargetsDraft } from '../targets/targets-draft';
import { planWords } from './figures';
import styles from './Climate.module.css';

/**
 * When the light comes on and for how long, changed on a sheet of its own:
 * the day it makes drawn from midnight to midnight beside the one that runs,
 * and what saving it does at once - a day turned into night on the spot, a
 * running plan paused, a control switched off switched on - said before the
 * tap. A length typed outside what the lamp can be told is refused under its
 * field, and the save waits.
 */
export function LightSheet({
  device,
  shape,
  baseline,
  now,
  offset,
  holding,
  offline,
  owned,
  planSets,
  longest,
  pauses,
  planName = null,
  switchesOn = false,
  busy,
  error,
  onSave,
  onClose,
}: {
  device: Device;
  shape: Shape;
  baseline: TargetsDraft;
  now: DateTime;
  offset: number;
  holding: NowHolding;
  offline: string | null;
  owned: ReadonlySet<Field>;
  planSets: { name: string; schedule: LightSchedule } | null;
  longest?: number;
  pauses: (next: TargetsDraft) => string | null;
  /** The running plan, which writes the times back every hour where `owned` says so. */
  planName?: string | null;
  switchesOn?: boolean;
  busy: boolean;
  error: Error | null;
  onSave: (next: TargetsDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(baseline);
  const [asked, setAsked] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const refusedId = useId();
  const changed = draft.lightsOn !== baseline.lightsOn || draft.lightHours !== baseline.lightHours;
  const paused = changed ? pauses(draft) : null;
  const planSays = planName ? planWords(t, planName, owned) : null;

  const save = async () => {
    setAsked(true);
    if (await onSave(draft)) onClose();
  };

  return (
    <Sheet
      title={t('control.light.times')}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={busy || !changed || refused !== null}
          aria-describedby={refused ? refusedId : undefined}
          onClick={() => void save()}
        >
          {t(busy ? 'targets.saving' : 'targets.save')}
        </button>
      }
    >
      <div className={ui.stack3}>
        <LightPlan
          device={device}
          shape={shapeOf(device, draft)}
          storedShape={shape}
          draft={draft}
          baseline={baseline}
          set={setDraft}
          readOnly={busy}
          now={now}
          offset={offset}
          holding={holding}
          offline={offline}
          owned={owned}
          planSets={planSets}
          longest={longest}
          refusedId={refusedId}
          onRefused={setRefused}
        />
        {planSays ? <p className={styles.note}>{planSays}</p> : null}
        {paused ? (
          <p className={styles.warn} role="status">
            {t('targets.planTable.pauses', { name: paused })}
          </p>
        ) : null}
        {switchesOn && changed ? <p className={styles.note}>{t('climateControl.saveSwitchesOn')}</p> : null}
        {asked ? <Refused error={error} /> : null}
      </div>
    </Sheet>
  );
}
