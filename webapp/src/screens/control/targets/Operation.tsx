import { Power, Sprout, Sun, Wind, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { devicesPath } from '@/app/places';
import type { Device, DryingReturn } from '@fg2/shared-types/v1';
import type { WorkMode } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useConfigure } from '@/api/devices';
import { Sheet } from '@/ui/Sheet';
import { FieldSwitch } from '@/ui/advanced/Fields';
import { Help } from '@/ui/Help';
import { useSwitchOn } from '../../devices/switch-on';
import { targetFigure, UNIT } from '../../home/units';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import day from './DayNight.module.css';
import styles from './Targets.module.css';

/**
 * What the device does as a whole, said where its targets are set: whether it
 * regulates at all, whether a drying phase has it drying, and - a fridge's
 * standard mode - whether the back-wall fan rests with the compressor.
 */

/**
 * The first line of the targets card where the device is not on its standard
 * day and night: switched off, drying, or in another operating mode - each
 * with the one way to change it beside it.
 *
 * Switched off, the card is this line alone, in the amber of a state somebody
 * chose: there is no table, because the device holds none of it, and the line
 * says what that means and switches it back on. A drying spell is said with
 * the way out of it - somebody who keeps no diary has no phase to end it with -
 * and another operating mode with the way to the device panel it was chosen
 * in. What the mode leaves of the targets is what the table under it shows.
 */
export function ControlState({ device, mayManage }: { device: Device; mayManage: boolean }) {
  // The question outlives the line it is asked from: ending the spell takes the
  // line away, and what happened is still to be read in the sheet.
  const [ending, setEnding] = useState<DryingReturn | null | undefined>(undefined);

  return (
    <>
      <ModeLine device={device} mayManage={mayManage} onEndDrying={() => setEnding(device.control?.afterDrying ?? null)} />
      {ending !== undefined ? <EndDryingSheet device={device} back={ending} onClose={() => setEnding(undefined)} /> : null}
    </>
  );
}

const MODE_ICON: Record<Exclude<WorkMode, 'standard'>, LucideIcon> = { greenhouse: Sun, germination: Sprout, drying: Wind };

function ModeLine({ device, mayManage, onEndDrying }: { device: Device; mayManage: boolean; onEndDrying: () => void }) {
  const { t } = useTranslation();
  const on = useSwitchOn(device);
  const control = device.control;
  if (!control) return null;

  if (!control.running) {
    const kind = device.type === 'fridge' || device.type === 'controller' ? device.type : 'other';
    return (
      <div className={day.mode} data-mode="off" role="status">
        <p className={day.modeText}>
          <Power size={16} strokeWidth={2} aria-hidden />
          <span>
            <strong>{t('climateControl.offTitle')}</strong> {t(mayManage ? `climateControl.offLine.${kind}` : 'climateControl.offLineRead')}
            <Help topic="climateControl" />
          </span>
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

  if (control.drying) {
    return (
      <div className={day.mode} data-mode="drying" role="status">
        <p className={day.modeText}>
          <MODE_ICON.drying size={16} strokeWidth={2} aria-hidden />
          <span>
            {t('climateControl.dryingNote')}
            <Help topic="drying" />
          </span>
        </p>
        {mayManage ? (
          <button type="button" className={ui.button} onClick={onEndDrying}>
            {t('climateControl.endDryingAsk')}
          </button>
        ) : null}
      </div>
    );
  }

  if (control.mode === 'standard') return null;
  const Icon = MODE_ICON[control.mode];

  return (
    <div className={day.mode} data-mode={control.mode} role="status">
      <p className={day.modeText}>
        <Icon size={16} strokeWidth={2} aria-hidden />
        <span>
          {t(`climateControl.modeNote.${control.mode}`)}
          <Help topic={control.mode === 'germination' ? 'germination' : 'advanced.operatingMode'} />
        </span>
      </p>
      {mayManage ? (
        <Link to={devicesPath(device.spaceId)} className={ui.headLink}>
          {t('climateControl.modeChange')} ›
        </Link>
      ) : null}
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
