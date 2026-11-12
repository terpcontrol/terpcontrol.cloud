import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { co2PlugOf, FAN_MODES } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useCo2Fan, useDevices } from '@/api/devices';
import { fieldValue } from '@/ui/advanced/field-values';
import { deviceTitle } from '@/ui/naming';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useSettings, type Settings } from '../climate/saved';
import { ChoiceSetting, NumberSetting, SettingsBlock } from './Settings';
import { figureSaid, pendingOf } from './setting-words';
import climate from '../climate/Climate.module.css';
import styles from './Own.module.css';

/**
 * An AIR fan's own control: what its speed follows and how fast it may run.
 * At a fixed speed it reads no target, so this is all it is set to; following
 * a reading, the temperature and the humidity it is held to stand under it as
 * a controller's targets do.
 *
 * Day and night are the fan's own: it tells them apart by its light sensor, so
 * its night is when the lamp it hangs under is off.
 */
export function FanPanel({ device, mayManage }: { device: Device; mayManage: boolean }) {
  const { t } = useTranslation();
  const settings = useSettings(device);
  const unit = t('targets.unit.percent');
  const options = FAN_MODES.map(one => ({ value: one, label: t(`fanSettings.mode.${one}`) }));
  const speed = (name: string): number => {
    const value = fieldValue(device, name);
    return typeof value === 'number' ? value : 100;
  };
  const tooLow = (most: number, least: number) => (most < least ? t('fanSettings.mostBelowLeast') : null);
  const speeds =
    fieldValue(device, 'fanMode') === 'fixed'
      ? [{ name: 'fixedDay' }, { name: 'fixedNight' }]
      : [
          { name: 'mostDay', invalid: (value: number) => tooLow(value, speed('least')) },
          { name: 'mostNight', invalid: (value: number) => tooLow(value, speed('least')) },
          { name: 'least', invalid: (value: number) => tooLow(Math.min(speed('mostDay'), speed('mostNight')), value) },
        ];
  const lines = speeds.map(one => ({ ...one, label: t(`fanSettings.aria.${one.name}`), say: figureSaid(unit) }));

  return (
    <SettingsBlock
      title={t('fanSettings.title')}
      error={settings.error}
      pending={pendingOf(device, settings, [
        { name: 'fanMode', label: t('fanSettings.mode.label'), say: value => options.find(option => option.value === value)?.label ?? '' },
        ...lines,
      ])}
    >
      <ChoiceSetting
        device={device}
        settings={settings}
        mayManage={mayManage}
        name="fanMode"
        label={t('fanSettings.mode.label')}
        help="fanMode"
        options={options}
      />
      {lines.map((line, index) => (
        <NumberSetting
          key={line.name}
          device={device}
          settings={settings}
          mayManage={mayManage}
          name={line.name}
          label={line.label}
          help={index === 0 ? 'fanSpeeds' : undefined}
          unit={unit}
          step={5}
          invalid={'invalid' in line ? line.invalid : undefined}
        />
      ))}
      <Slowed fan={device} settings={settings} mayManage={mayManage} />
    </SettingsBlock>
  );
}

/**
 * A fan a Plantalytix Socket slows down while it doses CO2 says so, with the
 * way to end it - which is a change to the socket, where the coupling is kept.
 */
function Slowed({ fan, settings, mayManage }: { fan: Device; settings: Settings; mayManage: boolean }) {
  const { t } = useTranslation();
  const devices = useDevices();
  const plugId = co2PlugOf(fan.configuration);
  const couple = useCo2Fan(plugId ?? '');
  if (!plugId) return null;

  const plug = devices.data?.items.find(one => one.id === plugId) ?? null;
  const slowedTo = (fan.configuration?.co2inject as { speed?: unknown } | undefined)?.speed;
  const speed = typeof slowedTo === 'number' ? slowedTo : 100;
  const uncouple = async () => {
    try {
      await couple.mutateAsync({ fanId: null, speed: 100 });
      settings.say(t('fanSettings.uncoupled'), () => couple.mutateAsync({ fanId: fan.id, speed }));
    } catch {
      // Said under the button, from the write that was refused.
    }
  };

  return (
    <>
      <p className={climate.note}>
        {t('fanSettings.slowed', { plug: plug ? deviceTitle(plug, t, devices.data?.items) : t('devices.type.plug'), speed })}
      </p>
      {mayManage && plug ? (
        <button type="button" className={`${ui.button} ${styles.act}`} disabled={couple.isPending} onClick={() => void uncouple()}>
          {t('fanSettings.uncouple')}
        </button>
      ) : null}
      <Refused error={couple.error} />
    </>
  );
}
