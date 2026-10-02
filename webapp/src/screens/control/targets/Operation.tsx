import { Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useConfigure } from '@/api/devices';
import { FieldSwitch } from '@/ui/advanced/Fields';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './Targets.module.css';

/**
 * What the device does as a whole, said where its targets are set: whether it
 * regulates at all, whether a drying phase has it drying, and - a fridge's
 * standard mode - whether the back-wall fan rests with the compressor.
 */

/**
 * "Regelung aus" over the sliders, in the amber of a state somebody chose, with
 * the way back on beside it - and the save under the sliders does the same,
 * which is said too: somebody who sets targets wants them held. A drying spell
 * is said in a quiet card, because it is what the grow asked for, with the way
 * out of it beside: a drying fridge has no light and no CO2, and somebody who
 * keeps no diary has no phase to end it with.
 */
export function ControlState({ device, mayManage }: { device: Device; mayManage: boolean }) {
  const { t } = useTranslation();
  const configure = useConfigure(device.id);
  const control = device.control;
  if (!control || (control.running && !control.drying)) return null;

  if (control.drying) {
    return (
      <div className={`${ui.card} ${styles.planCard}`} data-status="drying" role="status">
        <p className={`${styles.planText} ${styles.drying}`}>
          {t('climateControl.dryingNote')}
          <Help topic="drying" />
        </p>
        {mayManage ? (
          <button type="button" className={ui.button} disabled={configure.isPending} onClick={() => configure.mutate({ drying: false })}>
            {t(configure.isPending ? 'climateControl.switching' : 'climateControl.endDrying')}
          </button>
        ) : null}
        <Refused error={configure.error} />
      </div>
    );
  }

  return (
    <div className={`${ui.card} ${styles.planCard}`} data-status="off" role="status">
      <p className={styles.planText}>
        <strong>{t('climateControl.offTitle')}</strong> {t(mayManage ? 'climateControl.offTargets' : 'climateControl.offTargetsRead')}
        <Help topic="climateControl" />
      </p>
      {mayManage ? (
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={configure.isPending}
          onClick={() => configure.mutate({ control: true })}
        >
          <Power size={16} strokeWidth={1.75} aria-hidden />
          {t(configure.isPending ? 'climateControl.switching' : 'climateControl.onAction')}
        </button>
      ) : null}
      <Refused error={configure.error} />
    </div>
  );
}

/**
 * The energy-saving switch of a fridge, under the targets rather than in
 * Erweitert, because whether a big plant needs the fan is a question of the
 * grow, asked again with every one. It belongs to the standard mode and is not
 * offered in another.
 */
export function EnergySaving({ device, mayManage }: { device: Device; mayManage: boolean }) {
  const { t } = useTranslation();
  const control = device.control;
  if (device.type !== 'fridge' || control?.mode !== 'standard') return null;

  return (
    <section className={`${ui.card} ${styles.operation}`} aria-label={t('energySaving.label')}>
      <FieldSwitch
        alone
        device={device}
        name="energySaving"
        label={t('energySaving.label')}
        help="energySaving"
        disabled={!mayManage}
        note={on => t(on ? 'energySaving.onNote' : 'energySaving.offNote')}
      />
    </section>
  );
}
