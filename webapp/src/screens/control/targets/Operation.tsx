import { Power } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { devicesPath } from '@/app/places';
import type { Device, DryingReturn } from '@fg2/shared-types/v1';
import { useConfigure } from '@/api/devices';
import { Sheet } from '@/log/Sheet';
import { FieldSwitch } from '@/ui/advanced/Fields';
import { Help } from '@/ui/Help';
import { useSwitchOn } from '../../devices/switch-on';
import { targetFigure, UNIT } from '../../home/units';
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
  // The question outlives the card it is asked from: ending the spell takes the
  // card away, and what happened is still to be read in the sheet.
  const [ending, setEnding] = useState<DryingReturn | null | undefined>(undefined);

  return (
    <>
      <ControlCard device={device} mayManage={mayManage} onEndDrying={() => setEnding(device.control?.afterDrying ?? null)} />
      {ending !== undefined ? <EndDryingSheet device={device} back={ending} onClose={() => setEnding(undefined)} /> : null}
    </>
  );
}

function ControlCard({ device, mayManage, onEndDrying }: { device: Device; mayManage: boolean; onEndDrying: () => void }) {
  const { t } = useTranslation();
  const on = useSwitchOn(device);
  const control = device.control;
  if (!control) return null;
  if (control.running && !control.drying && control.mode !== 'standard') {
    // Another operating mode holds only part of what the sliders set, which is
    // said over them rather than left to the device panel it was chosen in.
    return (
      <div className={`${ui.card} ${styles.planCard}`} data-status="mode" role="status">
        <p className={styles.planText}>
          {t(`climateControl.modeNote.${control.mode}`)}
          <Help topic="advanced.operatingMode" />
        </p>
        {mayManage ? (
          <Link to={devicesPath(device.spaceId)} className={ui.headLink}>
            {t('climateControl.modeChange')} ›
          </Link>
        ) : null}
      </div>
    );
  }
  if (control.running && !control.drying) return null;

  if (control.drying) {
    return (
      <div className={`${ui.card} ${styles.planCard}`} data-status="drying" role="status">
        <p className={`${styles.planText} ${styles.drying}`}>
          {t('climateControl.dryingNote')}
          <Help topic="drying" />
        </p>
        {mayManage ? (
          <button type="button" className={ui.button} onClick={onEndDrying}>
            {t('climateControl.endDryingAsk')}
          </button>
        ) : null}
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
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={on.pending} onClick={() => void on.switchOn()}>
          <Power size={16} strokeWidth={1.75} aria-hidden />
          {t(on.pending ? 'climateControl.switching' : 'climateControl.onAction')}
        </button>
      ) : null}
      <Refused error={on.error} />
    </div>
  );
}

/**
 * Ending a drying spell by itself, asked first: the device goes back to its day
 * and night, its light and its CO2, and the question says on which targets -
 * the ones that held before the spell began, written out, or where those were
 * never kept the ones recorded before it, to be checked afterwards.
 */
function EndDryingSheet({ device, back, onClose }: { device: Device; back: DryingReturn | null; onClose: () => void }) {
  const { t } = useTranslation();
  const configure = useConfigure(device.id);
  const done = configure.isSuccess;

  const actions = done ? (
    <button type="button" className={`${ui.button} ${ui.primary}`} onClick={onClose}>
      {t('maintenance.done')}
    </button>
  ) : (
    <>
      <Refused error={configure.error} />
      <button
        type="button"
        className={`${ui.button} ${ui.primary}`}
        disabled={configure.isPending}
        onClick={() => configure.mutate({ drying: false })}
      >
        {t(configure.isPending ? 'climateControl.switching' : 'climateControl.endDrying')}
      </button>
      <button type="button" className={ui.button} onClick={onClose}>
        {t('maintenance.cancel')}
      </button>
    </>
  );

  return (
    <Sheet title={t('climateControl.endDryingTitle')} onClose={onClose} actions={actions}>
      <div className={styles.endDrying} role={done ? 'status' : undefined}>
        {done ? (
          <p>{t('climateControl.endDryingDone')}</p>
        ) : (
          <>
            <p>{t('climateControl.endDryingDoes')}</p>
            <p>{back ? t('climateControl.endDryingBack', { targets: returnLine(t, back) }) : t('climateControl.endDryingRecord')}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Tag 25 °C · 60 %, Nacht 20 °C · 55 %, Licht 80 %, CO₂ 900 ppm", leaving out what the document never stated. */
const returnLine = (t: Translate, back: DryingReturn): string => {
  const pair = (temperature: number | null, humidity: number | null) =>
    [
      temperature === null ? null : `${targetFigure(temperature, 'temperature')} ${UNIT.temperature}`,
      humidity === null ? null : `${targetFigure(humidity, 'humidity')} ${UNIT.humidity}`,
    ]
      .filter(Boolean)
      .join(' · ');
  const day = pair(back.dayTemperature, back.dayHumidity);
  const night = pair(back.nightTemperature, back.nightHumidity);

  return [
    day ? t('climateControl.returns.day', { values: day }) : null,
    night ? t('climateControl.returns.night', { values: night }) : null,
    back.lightLimit === null ? null : t('climateControl.returns.light', { percent: Math.round(back.lightLimit) }),
    back.co2 === null ? null : t('climateControl.returns.co2', { value: `${targetFigure(back.co2, 'co2')} ${UNIT.co2}` }),
  ]
    .filter(Boolean)
    .join(', ');
};

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
