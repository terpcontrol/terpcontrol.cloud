import { Power } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DryingReturn, GerminationChoices as Choices } from '@fg2/shared-types/v1';
import { GERMINATION_HUMIDITY, GERMINATION_TEMPERATURE, GERMINATION_TOO_HUMID } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { configurationFieldsOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useConfigure } from '@/api/devices';
import type { Translate } from '@/i18n/i18n';
import { FieldChoice, FieldSwitch } from '@/ui/advanced/Fields';
import { Announce } from '@/ui/Announce';
import { figureOf, germinates } from '@/ui/climate-hardware';
import { Help } from '@/ui/Help';
import { deviceName } from '@/ui/naming';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import { Answered, SheetAnswer } from '@/ui/SheetParts';
import { targetFigure, targetWithUnit } from '@/ui/units';
import ui from '@/ui/ui.module.css';
import { useSwitchOn } from '../devices/switch-on';
import { GerminationChoices } from './germination/GerminationChoices';
import { choicesOf, useHumidifier } from './germination/germination-choices';
import { hasMode } from './rows';
import styles from './Control.module.css';

/**
 * Betriebsart: what a fridge or a tent controller does as a whole while its
 * control is on, behind its own row under Steuerung - the one list of work
 * modes per type (`WORK_MODES_BY_TYPE`), a fridge's energy saving, what
 * germination does about the humidity while it runs, and the way out of a
 * drying spell for somebody who keeps no diary to end it with a phase.
 *
 * Standard is what everything else in the app assumes and is one tap; every
 * other mode darkens the device or stops it holding its humidity and is asked
 * first. Each choice is written on the tap.
 */

export function ModePage({ devices, mayManage }: { devices: Device[]; mayManage: boolean }) {
  const { t } = useTranslation();
  const moded = devices.filter(hasMode);

  return (
    <div className={styles.page}>
      {moded.map(device => (
        <section key={device.id} className={styles.block} aria-label={deviceName(device, t)}>
          {moded.length > 1 ? <h2 className={styles.blockTitle}>{deviceName(device, t)}</h2> : null}
          <DeviceMode device={device} mayManage={mayManage} />
        </section>
      ))}
    </div>
  );
}

function DeviceMode({ device, mayManage }: { device: Device; mayManage: boolean }) {
  const { t } = useTranslation();
  const control = device.control;
  const humidifier = useHumidifier(device);
  // The question outlives the line it is asked from: ending the spell takes the line away, and what happened is still to be read.
  const [ending, setEnding] = useState<DryingReturn | null | undefined>(undefined);
  const field = configurationFieldsOf(device.type).mode;
  const modes = field?.kind === 'choice' ? field.options : [];
  // What germination will do about the humidity is said before the switch, as everywhere germination is set.
  const choices = choicesOf(device);
  const choicesSaid = [
    t(choices.warnTooHumid ? 'germinationChoices.alarmOn' : 'germinationChoices.alarmOff', { line: GERMINATION_TOO_HUMID }),
    humidifier
      ? choices.humidifierHolds
        ? t('germinationChoices.humidifierOn', { humidity: targetWithUnit(GERMINATION_HUMIDITY, 'humidity') })
        : t('germinationChoices.humidifierOff')
      : null,
    t('operatingMode.choicesAfter'),
  ]
    .filter(Boolean)
    .join(' ');
  const figures = {
    temperature: targetFigure(GERMINATION_TEMPERATURE, 'temperature'),
    humidity: targetFigure(GERMINATION_HUMIDITY, 'humidity'),
  };

  if (!control) return null;
  if (!control.running) return <ControlOff device={device} mayManage={mayManage} />;
  // Whoever may not steer the place reads which mode holds, and is drawn no choice they could not make.
  if (!mayManage) {
    return (
      <p className={styles.card}>
        <span className="label">{t('operatingMode.label')}</span>
        {[t(`operatingMode.${control.drying ? 'drying' : control.mode}`), control.energySaving ? t('energySaving.label') : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
    );
  }

  return (
    <>
      {control.drying ? (
        <div className={styles.state} data-tone="warn">
          <p>
            {t('climateControl.dryingNote')}
            <Help topic="drying" />
          </p>
          <button type="button" className={ui.button} onClick={() => setEnding(control.afterDrying ?? null)}>
            {t('climateControl.endDryingAsk')}
          </button>
        </div>
      ) : null}
      <div className={styles.card}>
        <FieldChoice
          device={device}
          name="mode"
          label={t('operatingMode.label')}
          help="advanced.operatingMode"
          options={modes.map(mode => ({ value: mode, label: t(`operatingMode.${mode}`), note: t(`operatingMode.${mode}Note`, figures) }))}
          ask={mode =>
            mode === 'standard'
              ? null
              : {
                  question: [
                    t('operatingMode.ask', { mode: t(`operatingMode.${mode}`), what: t(`operatingMode.${mode}Note`, figures) }),
                    mode === 'germination' ? choicesSaid : null,
                  ]
                    .filter(Boolean)
                    .join(' '),
                  yes: t('operatingMode.yes', { mode: t(`operatingMode.${mode}`) }),
                }
          }
        />
        {germinates(device) ? <Choosing device={device} humidifier={humidifier} /> : null}
      </div>
      {/* Energy saving belongs to a day and night of the standard mode, which neither a drying spell nor germination is. */}
      {device.type === 'fridge' && control.mode === 'standard' && !control.drying ? (
        <div className={styles.card}>
          <FieldSwitch
            alone
            device={device}
            name="energySaving"
            label={t('energySaving.label')}
            help="energySaving"
            note={on => t(on ? 'energySaving.onNote' : 'energySaving.offNote')}
          />
        </div>
      ) : null}
      {ending !== undefined ? <EndDryingSheet device={device} back={ending} onClose={() => setEnding(undefined)} /> : null}
    </>
  );
}

/**
 * A device whose control is switched off, said where its climate would stand:
 * there is no table, because it holds none of it, and the one way out is
 * beside the sentence - on is one tap, as it is the state everything else
 * assumes. Switching off is on the device's own page.
 */
export function ControlOff({ device, mayManage }: { device: Device; mayManage: boolean }) {
  const { t } = useTranslation();
  const on = useSwitchOn(device);
  const kind = device.type === 'fridge' || device.type === 'controller' ? device.type : 'other';

  return (
    <div className={styles.state} data-tone="warn">
      <p>
        <strong>{t('climateControl.offTitle')}</strong> {t(mayManage ? `climateControl.offLine.${kind}` : 'climateControl.offLineRead')}
        <Help topic="climateControl" />
      </p>
      {mayManage ? (
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={on.pending} onClick={() => void on.switchOn()}>
          <Power size={16} strokeWidth={1.75} aria-hidden />
          {t(on.pending ? 'climateControl.switching' : 'climateControl.onAction')}
        </button>
      ) : null}
      <Refused error={on.error} />
      <Announce text={on.pending && t('climateControl.switching')} />
    </div>
  );
}

/** The two choices of germination, each written on the tap through the settings by name. */
function Choosing({ device, humidifier }: { device: Device; humidifier: boolean }) {
  const configure = useConfigure(device.id);
  const asked = configure.isPending ? configure.variables : undefined;
  const stored = choicesOf(device);
  const shown: Choices = {
    warnTooHumid: typeof asked?.germinationWarnTooHumid === 'boolean' ? asked.germinationWarnTooHumid : stored.warnTooHumid,
    humidifierHolds: typeof asked?.germinationHumidifier === 'boolean' ? asked.germinationHumidifier : stored.humidifierHolds,
  };
  const humidity = device.configuration ? figureOf(device.configuration, 'night', 'humidity') : null;

  return (
    <>
      <GerminationChoices
        value={shown}
        humidifier={humidifier}
        humidity={humidity}
        disabled={configure.isPending}
        onChange={change =>
          configure.mutate({
            ...(change.warnTooHumid !== undefined ? { germinationWarnTooHumid: change.warnTooHumid } : {}),
            ...(change.humidifierHolds !== undefined ? { germinationHumidifier: change.humidifierHolds } : {}),
          })
        }
      />
      <Refused error={configure.error} />
    </>
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

  return (
    <Sheet
      title={t('climateControl.endDryingTitle')}
      onClose={onClose}
      actions={
        <SheetAnswer done={done} error={configure.error} onClose={onClose}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={configure.isPending}
            onClick={() => configure.mutate({ drying: false })}
          >
            {t(configure.isPending ? 'climateControl.switching' : 'climateControl.endDrying')}
          </button>
        </SheetAnswer>
      }
    >
      <div className={styles.sheetText}>
        {done ? (
          <Answered>{t('climateControl.endDryingDone')}</Answered>
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

/** "Tag 25 °C · 60 %, Nacht 20 °C · 55 %, Licht 80 %, CO₂ 900 ppm", leaving out what the document never stated. */
const returnLine = (t: Translate, back: DryingReturn): string => {
  const pair = (temperature: number | null, humidity: number | null) =>
    [temperature === null ? null : targetWithUnit(temperature, 'temperature'), humidity === null ? null : targetWithUnit(humidity, 'humidity')]
      .filter(Boolean)
      .join(' · ');
  const day = pair(back.dayTemperature, back.dayHumidity);
  const night = pair(back.nightTemperature, back.nightHumidity);

  return [
    day ? t('climateControl.returns.day', { values: day }) : null,
    night ? t('climateControl.returns.night', { values: night }) : null,
    back.lightLimit === null ? null : t('climateControl.returns.light', { percent: Math.round(back.lightLimit) }),
    back.co2 === null ? null : t('climateControl.returns.co2', { value: targetWithUnit(back.co2, 'co2') }),
  ]
    .filter(Boolean)
    .join(', ');
};
