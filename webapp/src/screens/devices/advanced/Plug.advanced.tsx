import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { co2FanOf, CO2_DOSINGS } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useCo2Fan, useDevices } from '@/api/devices';
import { useSettings, type Settings } from '@/screens/control/climate/saved';
import { FigureButton, ValueSheet } from '@/screens/control/climate/ValueSheet';
import { ChoiceSetting, ChoiceSheet, NumberSetting, SettingLine, SettingsBlock, SwitchSetting } from '@/screens/control/devices/Settings';
import { figureSaid, onOff, pendingOf } from '@/screens/control/devices/setting-words';
import { fieldValue } from '@/ui/advanced/field-values';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import type { HelpTopic } from '@/ui/explain';
import { deviceTitle } from '@/ui/naming';
import ui from '@/ui/ui.module.css';

/**
 * What few owners of a Plantalytix Socket ever change: how it doses CO2 and
 * the AIR fan it slows while it does, and the protections that switch it off
 * whatever it is regulating. Its work mode and its switch points are under
 * Steuerung.
 */

/** Dosing CO2 the whole time, or in a window of every period - and the fan slowed in those windows. */
function Co2Dosing({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const settings = useSettings(device);
  const minutes = t('units.min');
  const options = CO2_DOSINGS.map(dosing => ({ value: dosing, label: t(`plugCo2.${dosing}`) }));
  const shared = { device, settings, mayManage };
  const windows = [
    { name: 'co2Every', label: t('plugCo2.every'), say: figureSaid(minutes) },
    { name: 'co2For', label: t('plugCo2.for'), say: figureSaid(minutes) },
  ];

  return (
    <SettingsBlock
      pending={pendingOf(device, settings, [
        { name: 'co2Dosing', label: t('plugCo2.label'), say: value => options.find(option => option.value === value)?.label ?? '' },
        ...windows,
      ])}
    >
      <ChoiceSetting {...shared} name="co2Dosing" label={t('plugCo2.label')} help="advanced.co2Dosing" options={options} />
      {fieldValue(device, 'co2Dosing') === 'periodic' ? (
        <>
          {windows.map(one => (
            <NumberSetting key={one.name} {...shared} name={one.name} label={one.label} unit={minutes} />
          ))}
          <FanSlowing {...shared} />
        </>
      ) : null}
    </SettingsBlock>
  );
}

/**
 * The AIR fan to slow while the socket doses, so the gas is not blown out of
 * the tent as soon as it is in. Offered only where the account has a fan; the
 * fan is told the socket's windows by the server and kept in step with them.
 * The coupling is two documents, so it has a write of its own.
 */
function FanSlowing({ device, settings, mayManage }: Pick<DeviceContext, 'device' | 'mayManage'> & { settings: Settings }) {
  const { t } = useTranslation();
  const devices = useDevices();
  const couple = useCo2Fan(device.id);
  const [open, setOpen] = useState<'fan' | 'speed' | null>(null);
  const fans = (devices.data?.items ?? []).filter(one => one.type === 'fan');
  const coupled = co2FanOf(device.configuration);
  if (fans.length === 0) return null;

  const nameOf = (fanId: string | null) => {
    const fan = fans.find(one => one.id === fanId);
    return fan ? deviceTitle(fan, t, devices.data?.items) : t('plugCo2.noFan');
  };
  const percent = figureSaid(t('targets.unit.percent'));
  const put = async (next: { fanId: string | null; speed: number }, what: string): Promise<boolean> => {
    try {
      await couple.mutateAsync(next);
      settings.say(what, () => couple.mutateAsync(coupled ?? { fanId: null, speed: 100 }));
      return true;
    } catch {
      // Said in the sheet that asked, from the write that was refused.
      return false;
    }
  };

  return (
    <>
      <SettingLine label={t('plugCo2.fan')} help="advanced.co2Fan">
        <FigureButton
          word
          name={t('plugCo2.fan')}
          text={nameOf(coupled?.fanId ?? null)}
          pending={false}
          onOpen={mayManage ? () => setOpen('fan') : null}
        />
      </SettingLine>
      {coupled ? (
        <SettingLine label={t('plugCo2.fanSpeed')}>
          <FigureButton
            name={t('plugCo2.fanSpeed')}
            text={percent(coupled.speed)}
            pending={false}
            onOpen={mayManage ? () => setOpen('speed') : null}
          />
        </SettingLine>
      ) : null}
      {open === 'fan' ? (
        <ChoiceSheet
          title={t('plugCo2.fan')}
          help="advanced.co2Fan"
          options={[{ value: '', label: t('plugCo2.noFan') }, ...fans.map(fan => ({ value: fan.id, label: nameOf(fan.id) }))]}
          chosen={coupled?.fanId ?? ''}
          busy={couple.isPending}
          error={couple.error}
          onSave={fanId => put({ fanId: fanId || null, speed: fanId ? (coupled?.speed ?? 30) : 100 }, `${t('plugCo2.fan')} ${nameOf(fanId || null)}`)}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === 'speed' && coupled ? (
        <ValueSheet
          title={t('plugCo2.fanSpeed')}
          figures={[{ key: 'speed', label: t('plugCo2.fanSpeed'), value: coupled.speed, min: 0, max: 100, step: 5, unit: t('targets.unit.percent') }]}
          busy={couple.isPending}
          error={couple.error}
          onSave={values => put({ fanId: coupled.fanId, speed: values.speed }, `${t('plugCo2.fanSpeed')} ${percent(values.speed)}`)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Off above a temperature, off below one, and a least time on and off between
 * two switchings. A build that does not say it keeps to them reads them and
 * does nothing with them, so they are not offered there, and that is said.
 */
function Protections({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const settings = useSettings(device);
  const kept = device.state?.hardware?.protections === 'on';
  const shared = { device, settings, mayManage: mayManage && kept };
  const degrees = t('targets.unit.temperature');
  const seconds = t('units.s');
  const figure = (name: string, key: string, unit: string) => ({
    name,
    label: t(`plugProtections.${key}`),
    unit,
    decimals: unit === degrees ? 1 : 0,
  });
  const groups: { name: string; label: string; help?: HelpTopic; figures: ReturnType<typeof figure>[] }[] = [
    {
      name: 'overheatOff',
      label: t('plugProtections.overheat'),
      help: 'advanced.plugProtections',
      figures: [figure('overheatAt', 'overheatAt', degrees), figure('overheatBack', 'overheatBack', degrees)],
    },
    { name: 'coldOff', label: t('plugProtections.cold'), figures: [figure('coldAt', 'coldAt', degrees), figure('coldBack', 'coldBack', degrees)] },
    {
      name: 'leastTimes',
      label: t('plugProtections.least'),
      figures: [figure('leastOnSeconds', 'leastOn', seconds), figure('leastOffSeconds', 'leastOff', seconds)],
    },
  ];

  return (
    <SettingsBlock
      error={settings.error}
      pending={pendingOf(
        device,
        settings,
        groups.flatMap(group => [
          { name: group.name, label: group.label, say: value => onOff(t, value) },
          ...group.figures.map(one => ({ name: one.name, label: one.label, say: figureSaid(one.unit, one.decimals) })),
        ]),
      )}
    >
      {groups.map(group => (
        <Fragment key={group.name}>
          <SwitchSetting {...shared} name={group.name} label={group.label} help={group.help} />
          {fieldValue(device, group.name) === true ? group.figures.map(one => <NumberSetting key={one.name} {...shared} {...one} />) : null}
        </Fragment>
      ))}
      {kept ? null : <p className={ui.note}>{t('plugProtections.needsFirmware')}</p>}
    </SettingsBlock>
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
