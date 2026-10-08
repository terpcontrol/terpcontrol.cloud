import { useTranslation } from 'react-i18next';
import type { GerminationChoices as Choices } from '@fg2/shared-types/v1';
import { GERMINATION_HUMIDITY, GERMINATION_TEMPERATURE, GERMINATION_TOO_HUMID } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { configurationFieldsOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useConfigure } from '@/api/devices';
import { GerminationChoices } from '@/screens/control/germination/GerminationChoices';
import { choicesOf } from '@/screens/control/germination/germination-choices';
import { FieldChoice } from '@/ui/advanced/Fields';
import { figureOf, germinates } from '@/ui/climate-hardware';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { Refused } from '@/ui/PageState';
import { targetFigure, targetWithUnit } from '@/ui/units';

/**
 * Betriebsart: what a fridge or a tent controller does as a whole while its
 * control is on, offered from the one list of work modes per type
 * (`WORK_MODES_BY_TYPE`). Standard is what everything else in the app assumes;
 * dark germination and drying are stages as well and are usually reached from
 * one, and the temperature-only mode is a fridge's for the few who grow that
 * way, which is why they are here and not only under Steuerung. Energy saving belongs to a fridge's
 * standard mode and is switched under Steuerung.
 *
 * While the device germinates, what germination does about the humidity is
 * chosen under the mode, as everywhere else germination is set; each switch
 * goes out on the tap, like the mode above it.
 */
function OperatingMode({ device, mayManage, sockets }: DeviceContext) {
  const { t } = useTranslation();
  const field = configurationFieldsOf(device.type).mode;
  const modes = field?.kind === 'choice' ? field.options : [];
  const germinating = germinates(device);
  const humidifier = sockets?.items?.some(socket => socket.role === 'humidifier') ?? false;
  // What germination will do about the humidity is said before the switch, as everywhere else germination is
  // set; the two switches to change it stand here once it runs. Germination brings its own humidity, so that is
  // the one a humidifier will hold.
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
  // What germination brings, in the notes that say it.
  const figures = {
    temperature: targetFigure(GERMINATION_TEMPERATURE, 'temperature'),
    humidity: targetFigure(GERMINATION_HUMIDITY, 'humidity'),
  };

  return (
    <>
      <FieldChoice
        device={device}
        name="mode"
        label={t('operatingMode.label')}
        help="advanced.operatingMode"
        disabled={!mayManage}
        options={modes.map(mode => ({ value: mode, label: t(`operatingMode.${mode}`), note: t(`operatingMode.${mode}Note`, figures) }))}
        // Germination and drying darken the device and the greenhouse mode stops holding its humidity: a tap in
        // bloom would cost a night of light, so each is asked first. Back to the standard is written at once.
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
      {germinating ? <Choosing device={device} mayManage={mayManage} humidifier={humidifier} /> : null}
    </>
  );
}

/** The two choices of germination, each written on the tap through the settings by name. */
function Choosing({ device, mayManage, humidifier }: Pick<DeviceContext, 'device' | 'mayManage'> & { humidifier: boolean }) {
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
        disabled={!mayManage || configure.isPending}
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

export const items = [
  advancedItem({
    scope: 'device',
    id: 'operating-mode',
    order: 10,
    shows: ({ device }) => configurationFieldsOf(device.type).mode !== undefined && Boolean(device.control),
    Item: OperatingMode,
  }),
];
