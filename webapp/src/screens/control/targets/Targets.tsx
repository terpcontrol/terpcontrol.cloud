import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, DeviceConfiguration } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useSaveConfiguration } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition } from '@/api/plans';
import { ageAttribute, ageLabel, deviceLiveness } from '@/ui/age';
import { awaitingClimate, hasCo2Sensor, statesTargets } from '@/ui/climate-hardware';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { nowThere, CLOCK, useZone } from '@/ui/zone';
import { deviceTitle } from '../../devices/naming';
import { figure } from '../../home/units';
import { TargetRow } from './TargetRow';
import {
  draftOf,
  equalsPreset,
  leafOffset,
  lightWindowLabel,
  prefilled,
  PRESET_CHIPS,
  presetOf,
  sameDraft,
  vpdOf,
  withDraft,
  type PresetChip,
  type TargetsDraft,
} from './targets-draft';
import styles from './Targets.module.css';

/**
 * The targets a tent is held at, set by hand.
 *
 * This is the page a plan is walked away from: a stage's figures are only a
 * starting point here, so the chips prefill the sliders and write nothing, and
 * one Save sends the whole document. A plan that is running would put its own
 * targets back within the hour - the engine re-applies the step it stands on -
 * so saving over one pauses it first and says so beforehand, in the amber the
 * app keeps for a state somebody chose. Every device standing here that states
 * a climate gets a panel of its own, because the targets are that device's
 * document and a tent with two controllers holds two.
 *
 * A tent with nothing to set is a page with nowhere to go: the crumb back to
 * the plan and the row under Advanced would both lead somewhere as empty as
 * this, so neither is drawn and the note says which of the two reasons this
 * tent has - a place with no climate-holding hardware in it is offered the one
 * thing that helps, which is claiming a device into it.
 */
export function Targets({ spaceId, devices, mayManage }: { spaceId: string; devices: Device[]; mayManage: boolean }) {
  const { t } = useTranslation();
  // A device that has never sent its document, or whose document states no
  // climate - a plug, a light - has nothing a target could be written into.
  const controllers = devices.flatMap(device =>
    device.configuration && statesTargets(device.configuration) ? [{ device, configuration: device.configuration }] : [],
  );
  // Which of those two it is matters, because only one of them is anybody's to
  // do something about: a controller reporting 25.1 °C a tab away, whose
  // document has simply not arrived yet, was told that nothing standing here
  // states a climate and offered a second device it has no use for. The
  // Devices tab of the same tent has always said this correctly.
  const waiting = devices.filter(awaitingClimate);

  if (controllers.length === 0) {
    return (
      <div className={styles.page}>
        <header className={ui.subhead}>
          <span className="label">{t('targets.title')}</span>
        </header>
        {waiting.length > 0 ? (
          waiting.map(device => (
            <p key={device.id} className={`${ui.cardDashed} ${ui.note}`}>
              {t('targets.waiting', { device: deviceTitle(device, t) })}
            </p>
          ))
        ) : (
          <p className={`${ui.cardDashed} ${ui.note}`}>
            {t('targets.nothing')}{' '}
            <Link to={`/spaces/${spaceId}/devices`} className={styles.addDevice}>
              {t('space.control.noControllerAdd')}
            </Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={ui.subhead}>
        <span className="label">{t('targets.title')}</span>
        <Link to={`/spaces/${spaceId}/control`} className={`mono ${styles.back}`}>
          {t('targets.backToPlan')}
        </Link>
      </header>

      {controllers.map(({ device, configuration }) => (
        <Panel key={device.id} device={device} stored={configuration} mayManage={mayManage} titled={controllers.length > 1} />
      ))}

      <p className={`mono ${styles.advanced}`}>
        <span className="label">{t('space.control.advanced')} ›</span>
        <Link to={`/spaces/${spaceId}/control/alarms`}>{t('space.control.advancedAlarms')}</Link>
        {' · '}
        <Link to={`/spaces/${spaceId}/devices`}>{t('targets.sockets')}</Link>
      </p>
    </div>
  );
}

/** The state of one panel's editing: what the sliders stand at, and which stored document they were moved against. */
interface Edit {
  draft: TargetsDraft;
  against: DeviceConfiguration;
}

/** What the last save sent, so the sliders stay where they were put until the device's document catches up. */
interface Sent {
  draft: TargetsDraft;
  at: DateTime;
}

function Panel({ device, stored, mayManage, titled }: { device: Device; stored: DeviceConfiguration; mayManage: boolean; titled: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  // When the save went out is a clock time the grower reads against the hours
  // on their own screens, so it is their account's - and written the app's one
  // way, which the locale preset here was not.
  const zone = useZone();
  const plan = useDevicePlan(device.id);
  const save = useSaveConfiguration();
  const move = usePlanTransition(device.id);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  // A draft holds until the stored document moves - so a save in flight does
  // not snap the sliders back, and a figure dialled in on the device itself
  // takes them over as soon as it arrives.
  const baseline = draftOf(stored);
  const draft = edit && edit.against === stored ? edit.draft : baseline;
  const dirty = !sameDraft(draft, baseline) && !(sent !== null && sameDraft(draft, sent.draft));
  const set = (next: TargetsDraft) => setEdit({ draft: next, against: stored });

  const hasCo2 = hasCo2Sensor(device);
  const status = plan.data?.state.status ?? null;
  const liveness = deviceLiveness(device.state.lastSeenAt, now);
  const busy = save.isPending || move.isPending;
  const name = device.name ?? t(`devices.type.${device.type}`, { defaultValue: device.type });

  // Saving over a running plan pauses it first: a plan that kept running would
  // write its step's targets over these within the hour. The errors of either
  // step are the mutations' own and are drawn from there.
  const commit = async () => {
    try {
      if (status === 'running') await move.mutateAsync({ kind: 'pause', reason: t('targets.pauseReason') });
      await save.mutateAsync({ deviceId: device.id, configuration: withDraft(stored, draft) });
      setSent({ draft, at: serverNow() });
    } catch {
      // Shown under the bar, from the mutation that refused.
    }
  };

  const chosen = (chip: PresetChip): boolean => {
    const preset = presetOf(chip);
    return preset !== null && equalsPreset(draft, preset, hasCo2);
  };

  const chipLabel = (chip: PresetChip): string => {
    if (chip.preset === null) return t(`home.stage.${chip.stage}`);
    const preset = t(`grow.presetName.${chip.preset}`, { defaultValue: chip.preset });
    return chip.preset === 'autoflower' ? `${preset} · ${t(`home.stage.${chip.stage}`)}` : preset;
  };

  /**
   * The deficit the pair of sliders beside it amounts to. It is a reading like
   * any other the app writes, so it goes through the writer every other reading
   * goes through: written straight it was decimated in English whatever
   * language the panel was in, so a German grower set "Luftfeuchte 58 %" and
   * was answered "VPD 1.0" on a screen that writes "0,98 kPa" for the same
   * quantity on the card they came from. The decimals are the metric's own, and
   * a deficit is written to two of them everywhere else in the app.
   */
  const vpd = (temperature: number, humidity: number, when: 'day' | 'night') =>
    t('targets.vpd', { value: figure(vpdOf(temperature, humidity, leafOffset(device.settings, when)), 'vpd') });

  if (plan.isPending) {
    return (
      <section className={styles.panel}>
        {titled ? <h2 className={styles.deviceName}>{name}</h2> : null}
        <Waiting lines={4} />
      </section>
    );
  }

  // Whether a save has to pause a plan first is not something to guess at, so
  // a plan that could not be read is a panel that cannot be drawn yet. A device
  // being run by nothing is a fact, and the panel goes on without a card.
  if (!plan.data && !isMissing(plan.error)) {
    return (
      <section className={styles.panel}>
        {titled ? <h2 className={styles.deviceName}>{name}</h2> : null}
        <LoadFailed retry={() => void plan.refetch()} />
      </section>
    );
  }

  const readOnly = !mayManage;
  const nightId = `targets-${device.id}-night`;

  return (
    <section className={styles.panel} aria-label={name}>
      {titled ? <h2 className={styles.deviceName}>{name}</h2> : null}
      <RefreshFailed failedAt={plan.isError && plan.data ? plan.dataUpdatedAt : null} now={now} />

      <p className={ui.note}>{t('targets.prefill')}</p>
      <Choices label={t('targets.presets')}>
        {PRESET_CHIPS.map(chip => (
          <Choice
            key={`${chip.stage}:${chip.preset ?? ''}`}
            chosen={chosen(chip)}
            disabled={readOnly}
            onChoose={() => {
              const preset = presetOf(chip);
              if (preset) set(prefilled(draft, preset));
            }}
          >
            {chipLabel(chip)}
          </Choice>
        ))}
      </Choices>

      <Block grouped label={t('targets.day')} aside={<a href={`#${nightId}`}>{t('targets.toNight')}</a>}>
        <TargetRow
          id={`targets-${device.id}-day-temperature`}
          label={t('targets.temperature')}
          name={t('targets.aria.dayTemperature')}
          value={draft.dayTemperature}
          min={15}
          max={35}
          step={0.5}
          unit={t('targets.unit.temperature')}
          disabled={readOnly}
          onChange={dayTemperature => set({ ...draft, dayTemperature })}
        />
        <TargetRow
          id={`targets-${device.id}-day-humidity`}
          label={t('targets.humidity')}
          name={t('targets.aria.dayHumidity')}
          value={draft.dayHumidity}
          min={30}
          max={90}
          step={1}
          unit={t('targets.unit.humidity')}
          aside={vpd(draft.dayTemperature, draft.dayHumidity, 'day')}
          disabled={readOnly}
          onChange={dayHumidity => set({ ...draft, dayHumidity })}
        />
        <TargetRow
          id={`targets-${device.id}-light`}
          label={t('targets.light')}
          name={t('targets.aria.lightLimit')}
          value={draft.lightLimit}
          min={0}
          max={100}
          step={5}
          unit={t('targets.unit.percent')}
          aside={lightWindowLabel(draft, now, zone)}
          disabled={readOnly}
          onChange={lightLimit => set({ ...draft, lightLimit })}
        />
        <TargetRow
          id={`targets-${device.id}-light-hours`}
          label={t('targets.lightHours')}
          name={t('targets.aria.lightHours')}
          value={draft.lightHours}
          min={1}
          max={24}
          step={1}
          unit={t('targets.unit.hours')}
          disabled={readOnly}
          onChange={lightHours => set({ ...draft, lightHours })}
        />
        {hasCo2 ? (
          <TargetRow
            id={`targets-${device.id}-co2`}
            label={t('targets.co2')}
            name={t('targets.aria.co2')}
            value={draft.co2}
            min={400}
            max={1500}
            step={50}
            unit={t('targets.unit.co2')}
            disabled={readOnly}
            onChange={co2 => set({ ...draft, co2 })}
          />
        ) : (
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t('targets.co2')}</span>
            <span className={`mono ${styles.needs}`}>{t('targets.needsCo2')}</span>
          </div>
        )}
      </Block>

      <span id={nightId} className={styles.anchor} aria-hidden />
      <Block grouped label={t('targets.night')}>
        <TargetRow
          id={`targets-${device.id}-night-temperature`}
          label={t('targets.temperature')}
          name={t('targets.aria.nightTemperature')}
          value={draft.nightTemperature}
          min={15}
          max={35}
          step={0.5}
          unit={t('targets.unit.temperature')}
          disabled={readOnly}
          onChange={nightTemperature => set({ ...draft, nightTemperature })}
        />
        <TargetRow
          id={`targets-${device.id}-night-humidity`}
          label={t('targets.humidity')}
          name={t('targets.aria.nightHumidity')}
          value={draft.nightHumidity}
          min={30}
          max={90}
          step={1}
          unit={t('targets.unit.humidity')}
          aside={vpd(draft.nightTemperature, draft.nightHumidity, 'night')}
          disabled={readOnly}
          onChange={nightHumidity => set({ ...draft, nightHumidity })}
        />
      </Block>

      {status === 'running' ? (
        <div className={`${ui.card} ${styles.planCard}`} data-status="running" role="status">
          <p className={styles.planText}>{t('targets.planRunning')}</p>
        </div>
      ) : status === 'paused' ? (
        <div className={`${ui.card} ${styles.planCard}`} data-status="paused" role="status">
          <p className={styles.planText}>{t('targets.planPaused')}</p>
          {mayManage ? (
            <button type="button" className={ui.button} disabled={busy} onClick={() => move.mutate({ kind: 'resume' })}>
              {t('targets.resume')}
            </button>
          ) : null}
        </div>
      ) : null}
      {!dirty ? <Refused error={move.error} /> : null}

      {readOnly ? <p className={ui.note}>{t('targets.readOnly')}</p> : null}

      {sent ? (
        <p className={`mono ${styles.sent}`} role="status">
          {t('targets.sentAt', { time: nowThere(sent.at, zone).toFormat(CLOCK) })}
          <span className={styles.sentNote}>{t('targets.sentNote')}</span>
        </p>
      ) : null}

      {liveness === 'offline' ? (
        <p className={`mono ${styles.quiet}`} {...ageAttribute(liveness)}>
          {t('space.control.applied.quiet', { age: ageLabel(device.state.lastSeenAt, now) })}
        </p>
      ) : null}

      {dirty && mayManage ? (
        <div className={`${ui.card} ${styles.bar}`}>
          <span className={styles.barText}>{busy ? t('targets.saving') : t('targets.unsaved')}</span>
          <button type="button" className={ui.button} disabled={busy} onClick={() => setEdit(null)}>
            {t('targets.discard')}
          </button>
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy} onClick={() => void commit()}>
            {t('targets.save')}
          </button>
          <Refused error={save.error ?? move.error} />
        </div>
      ) : null}
    </section>
  );
}
