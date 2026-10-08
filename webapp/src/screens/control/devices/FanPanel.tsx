import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { co2PlugOf, FAN_MODES, type FanMode } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useCo2Fan, useDevices } from '@/api/devices';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { deviceTitle } from '@/ui/naming';
import type { Unsaved } from '../targets/LeaveGuard';
import { TargetRow } from '../targets/TargetRow';
import { useFieldsDraft } from './fields-draft';
import { OwnPanel } from './OwnPanel';
import styles from './Own.module.css';

/**
 * An AIR fan, under its targets: what its speed follows and how fast it may
 * run. The targets above it are the temperature and the humidity it is held
 * to; with a fixed speed it reads neither, which is said here rather than left
 * for somebody to find out from a curve that never moves.
 *
 * Day and night are the fan's own: it tells them apart by its light sensor, so
 * its night is when the lamp it hangs under is off.
 */

const FIELDS = ['fanMode', 'fixedDay', 'fixedNight', 'mostDay', 'mostNight', 'least'];

export function FanPanel(props: {
  device: Device;
  name: string;
  titled: boolean;
  mayManage: boolean;
  report: (deviceId: string, entry: Unsaved | null) => void;
  asking: boolean;
}) {
  const { t } = useTranslation();
  const draft = useFieldsDraft(props.device, FIELDS);
  const mode = draft.value<string>('fanMode', 'fixed') as FanMode;
  const readOnly = !props.mayManage;
  const percent = t('targets.unit.percent');

  const speed = (field: string, label: string, name: string, fallback: number) => (
    <TargetRow
      id={`fan-${props.device.id}-${field}`}
      label={label}
      name={name}
      value={draft.value<number>(field, fallback)}
      min={0}
      max={100}
      step={5}
      unit={percent}
      disabled={readOnly}
      onChange={value => draft.set(field, value)}
    />
  );

  const least = draft.value<number>('least', 100);
  const tooLow = mode !== 'fixed' && (draft.value<number>('mostDay', 100) < least || draft.value<number>('mostNight', 100) < least);

  return (
    <OwnPanel {...props} draft={draft} invalid={tooLow ? t('fanSettings.mostBelowLeast') : null}>
      <Block label={t('fanSettings.mode.label')} help="fanMode">
        <Choices label={t('fanSettings.mode.label')}>
          {FAN_MODES.map(one => (
            <Choice key={one} chosen={one === mode} disabled={readOnly} onChoose={() => draft.set('fanMode', one)}>
              {t(`fanSettings.mode.${one}`)}
            </Choice>
          ))}
        </Choices>
        <p className={`${ui.note} ${styles.note}`}>{t(`fanSettings.modeNote.${mode}`)}</p>
      </Block>

      <Block grouped label={t('fanSettings.speeds')} help="fanSpeeds">
        {mode === 'fixed' ? (
          <>
            {speed('fixedDay', t('fanSettings.day'), t('fanSettings.aria.fixedDay'), 100)}
            {speed('fixedNight', t('fanSettings.night'), t('fanSettings.aria.fixedNight'), 100)}
          </>
        ) : (
          <>
            {speed('mostDay', t('fanSettings.mostDay'), t('fanSettings.aria.mostDay'), 100)}
            {speed('mostNight', t('fanSettings.mostNight'), t('fanSettings.aria.mostNight'), 100)}
            {speed('least', t('fanSettings.least'), t('fanSettings.aria.least'), 100)}
          </>
        )}
      </Block>

      <Slowed fan={props.device} mayManage={props.mayManage} />
    </OwnPanel>
  );
}

/**
 * A fan a smart socket slows down while it doses CO2 says so, with the way to
 * end it - which is a change to the socket, where the coupling is kept.
 */
function Slowed({ fan, mayManage }: { fan: Device; mayManage: boolean }) {
  const { t } = useTranslation();
  const devices = useDevices();
  const plugId = co2PlugOf(fan.configuration);
  const uncouple = useCo2Fan(plugId ?? '');
  if (!plugId) return null;

  const plug = devices.data?.items.find(one => one.id === plugId) ?? null;
  const speed = (fan.configuration?.co2inject as { speed?: unknown } | undefined)?.speed;

  return (
    <section className={`${ui.card} ${styles.coupled}`}>
      <p className={styles.coupledText}>
        {t('fanSettings.slowed', {
          plug: plug ? deviceTitle(plug, t, devices.data?.items) : t('devices.type.plug'),
          speed: typeof speed === 'number' ? speed : 100,
        })}
      </p>
      {mayManage && plug ? (
        <button type="button" className={ui.chip} disabled={uncouple.isPending} onClick={() => uncouple.mutate({ fanId: null, speed: 100 })}>
          {t('fanSettings.uncouple')}
        </button>
      ) : null}
      <Refused error={uncouple.error} />
    </section>
  );
}
