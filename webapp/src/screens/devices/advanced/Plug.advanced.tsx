import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { co2FanOf, CO2_DOSINGS } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useCo2Fan, useDevices } from '@/api/devices';
import { fieldValue } from '@/ui/advanced/field-values';
import { FieldChoice, FieldNumber, FieldSwitch } from '@/ui/advanced/Fields';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { deviceTitle } from '@/ui/naming';
import styles from './DeviceAdvanced.module.css';

/**
 * What few owners of a stand-alone smart socket ever change: how it doses CO2
 * and the AIR fan it slows while it does, and the protections that switch it
 * off whatever it is regulating. Its work mode and its switch points are under
 * Steuerung.
 */

/** Dosing CO2 the whole time, or in a window of every period - and the fan slowed in those windows. */
function Co2Dosing({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const periodic = fieldValue(device, 'co2Dosing') === 'periodic';

  return (
    <>
      <FieldChoice
        device={device}
        name="co2Dosing"
        label={t('plugCo2.label')}
        help="advanced.co2Dosing"
        disabled={!mayManage}
        options={CO2_DOSINGS.map(dosing => ({ value: dosing, label: t(`plugCo2.${dosing}`), note: t(`plugCo2.${dosing}Note`) }))}
      />
      {periodic ? (
        <>
          <FieldNumber device={device} name="co2Every" label={t('plugCo2.every')} unit={t('units.min')} disabled={!mayManage} />
          <FieldNumber device={device} name="co2For" label={t('plugCo2.for')} unit={t('units.min')} disabled={!mayManage} />
          <FanSlowing device={device} mayManage={mayManage} />
        </>
      ) : null}
    </>
  );
}

/**
 * The AIR fan to slow while the socket doses, so the gas is not blown out of
 * the tent as soon as it is in. Offered only where the account has a fan; the
 * fan is told the socket's windows by the server and kept in step with them.
 */
function FanSlowing({ device, mayManage }: Pick<DeviceContext, 'device' | 'mayManage'>) {
  const { t } = useTranslation();
  const devices = useDevices();
  const couple = useCo2Fan(device.id);
  const fans = (devices.data?.items ?? []).filter(one => one.type === 'fan');
  const coupled = co2FanOf(device.configuration);
  const [choice, setChoice] = useState<{ fanId: string; speed: string } | null>(null);
  if (fans.length === 0) return null;

  const fanId = choice?.fanId ?? coupled?.fanId ?? '';
  const speedText = choice?.speed ?? String(coupled?.speed ?? 30);
  const speed = Number(speedText);
  const fits = Number.isInteger(speed) && speed >= 0 && speed <= 100;
  const changed = choice !== null && (fanId !== (coupled?.fanId ?? '') || speed !== coupled?.speed);
  const save = () => couple.mutate({ fanId: fanId === '' ? null : fanId, speed: fits ? speed : 100 }, { onSuccess: () => setChoice(null) });

  return (
    <>
      <SettingRow
        label={t('plugCo2.fan')}
        help="advanced.co2Fan"
        note={fanId === '' ? t('plugCo2.fanNone') : fits ? t('plugCo2.fanNote', { speed }) : t('advanced.range', { min: 0, max: 100, unit: '%' })}
        wide
      >
        <span className={styles.inline}>
          <select
            className={`${ui.input} ${styles.select}`}
            aria-label={t('plugCo2.fan')}
            value={fanId}
            disabled={!mayManage || couple.isPending}
            onChange={event => setChoice({ fanId: event.target.value, speed: speedText })}
          >
            <option value="">{t('plugCo2.noFan')}</option>
            {fans.map(fan => (
              <option key={fan.id} value={fan.id}>
                {deviceTitle(fan, t, devices.data?.items)}
              </option>
            ))}
          </select>
          {fanId === '' ? null : (
            <>
              <input
                className={`${ui.input} ${styles.percent}`}
                inputMode="numeric"
                aria-label={t('plugCo2.fanSpeed')}
                value={speedText}
                disabled={!mayManage || couple.isPending}
                onChange={event => setChoice({ fanId, speed: event.target.value })}
              />
              <span className="mono">%</span>
            </>
          )}
          {changed ? (
            <button type="button" className={ui.chip} disabled={!fits || couple.isPending} onClick={save}>
              {t('advanced.save')}
            </button>
          ) : null}
        </span>
      </SettingRow>
      <Refused error={couple.error} />
    </>
  );
}

/**
 * Off above a temperature, off below one, and a least time on and off between
 * two switchings. A build that does not say it keeps to them reads them and
 * does nothing with them, so they are shown greyed out with that said.
 */
function Protections({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const kept = device.state?.hardware?.protections === 'on';
  const disabled = !mayManage || !kept;
  const on = (name: string) => fieldValue(device, name) === true;
  const degrees = t('targets.unit.temperature');

  return (
    <>
      <FieldSwitch device={device} name="overheatOff" label={t('plugProtections.overheat')} help="advanced.plugProtections" disabled={disabled} />
      {on('overheatOff') ? (
        <>
          <FieldNumber device={device} name="overheatAt" label={t('plugProtections.overheatAt')} unit={degrees} disabled={disabled} />
          <FieldNumber device={device} name="overheatBack" label={t('plugProtections.overheatBack')} unit={degrees} disabled={disabled} />
        </>
      ) : null}
      <FieldSwitch device={device} name="coldOff" label={t('plugProtections.cold')} help="advanced.plugProtections" disabled={disabled} />
      {on('coldOff') ? (
        <>
          <FieldNumber device={device} name="coldAt" label={t('plugProtections.coldAt')} unit={degrees} disabled={disabled} />
          <FieldNumber device={device} name="coldBack" label={t('plugProtections.coldBack')} unit={degrees} disabled={disabled} />
        </>
      ) : null}
      <FieldSwitch
        device={device}
        name="leastTimes"
        label={t('plugProtections.least')}
        help="advanced.plugProtections"
        disabled={disabled}
        note={() => (kept ? null : t('plugProtections.needsFirmware'))}
      />
      {on('leastTimes') ? (
        <>
          <FieldNumber device={device} name="leastOnSeconds" label={t('plugProtections.leastOn')} unit={t('units.s')} disabled={disabled} />
          <FieldNumber device={device} name="leastOffSeconds" label={t('plugProtections.leastOff')} unit={t('units.s')} disabled={disabled} />
        </>
      ) : null}
    </>
  );
}

const isPlug = ({ device }: DeviceContext) => device.type === 'plug' && Boolean(device.configuration) && !device.isDemo;

export const items = [
  advancedItem({
    scope: 'device',
    id: 'plug-co2',
    order: 20,
    shows: context => isPlug(context) && context.device.configuration?.workmode === 'co2',
    Item: Co2Dosing,
  }),
  advancedItem({
    scope: 'device',
    id: 'plug-protections',
    order: 30,
    // The timer switches by the clock alone, and the firmware keeps no protection over it.
    shows: context => isPlug(context) && context.device.configuration?.workmode !== 'timer',
    Item: Protections,
  }),
];
