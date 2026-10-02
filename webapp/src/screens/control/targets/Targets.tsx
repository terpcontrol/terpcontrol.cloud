import type { DateTime } from 'luxon';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { controlPath } from '@/app/places';
import type { Device, DeviceConfiguration, GrowCard } from '@fg2/shared-types/v1';
import { useHome } from '@/api/home';
import { useDiaryLayer } from '@/api/layers';
import { serverNow } from '@/api/clock';
import { useDevices, useHeardAt, useSaveConfiguration } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition } from '@/api/plans';
import { ageAttribute, deviceLiveness, offlineLabel } from '@/ui/age';
import { awaitingClimate, hasCo2Sensor, statesTargets } from '@/ui/climate-hardware';
import { Help, Term } from '@/ui/Help';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { CLIMATE_CHOICES, climateChoiceName, type ClimateChoice } from '@/ui/presets';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { nowThere, CLOCK, useZone } from '@/ui/zone';
import { deviceTitle } from '../../devices/naming';
import { figure } from '../../home/units';
import { FanPanel } from '../devices/FanPanel';
import { LightPanel } from '../devices/LightPanel';
import { PlugPanel } from '../devices/PlugPanel';
import { LeaveGuard, type Unsaved } from './LeaveGuard';
import { LightsOnRow } from './LightsOnRow';
import { ControlState, EnergySaving } from './Operation';
import { TargetRow } from './TargetRow';
import {
  draftOf,
  equalsPreset,
  leafOffset,
  lightsOffOf,
  offsetOf,
  prefilled,
  presetOf,
  sameDraft,
  vpdOf,
  withDraft,
  type TargetsDraft,
} from './targets-draft';
import styles from './Targets.module.css';
import { deviceName } from '@/screens/devices/naming';

/**
 * The targets a tent is held at: what the Control tab opens on, unless a plan
 * is running and setting them itself.
 *
 * A stage's figures are only a starting point here, so the chips under the
 * sliders prefill them and write nothing, and one Save sends the whole
 * document. A plan that is running would put its own targets back within the
 * hour - the engine re-applies the step it stands on - so saving over one
 * pauses it first and says so beforehand, in the amber the app keeps for a
 * state somebody chose. Every device standing here that states
 * a climate gets a panel of its own, because the targets are that device's
 * document and a tent with two controllers holds two.
 *
 * A tent with nothing to set says which of the two reasons it has - a place
 * with no climate-holding hardware in it is offered the one thing that helps,
 * which is claiming a device into it. The ways on to the alarms and the plan
 * are the tab's, and stand under this page.
 */
export function Targets({
  spaceId,
  devices,
  mayManage,
  crumb = false,
}: {
  spaceId: string;
  devices: Device[];
  mayManage: boolean;
  /** Whether the tab opens on a running plan, which is then the way back from here. */
  crumb?: boolean;
}) {
  const { t } = useTranslation();
  const all = useDevices();
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
  // The panels whose sliders stand somewhere nobody has saved, so that leaving the page asks first.
  const [unsaved, setUnsaved] = useState<ReadonlyMap<string, Unsaved>>(new Map());
  const report = useCallback((deviceId: string, entry: Unsaved | null) => {
    setUnsaved(current => {
      if (entry === null && !current.has(deviceId)) return current;
      const next = new Map(current);
      if (entry) next.set(deviceId, entry);
      else next.delete(deviceId);
      return next;
    });
  }, []);
  // A fan's speeds are a second panel of the same device, handed up under a key of their own.
  const fanReport = useCallback((deviceId: string, entry: Unsaved | null) => report(`${deviceId}:speeds`, entry), [report]);
  const [asking, setAsking] = useState(false);
  // What grows here, for the one line under the chips that says the phase is not theirs to move.
  const home = useHome();
  const diary = useDiaryLayer();
  const grow = diary ? ((home.data?.spaces ?? []).find(card => card.spaceId === spaceId)?.grow ?? null) : null;

  // A smart socket and a lamp hold no climate of their own, but what they are
  // set to is their owner's whole reason to come here: their own panels stand
  // under the targets, or in their place.
  const own = devices.filter(device => OWN_PANEL_TYPES.includes(device.type));
  const titled = controllers.length + own.length > 1;
  const panels = own.map(device =>
    device.configuration ? (
      <OwnPanelOf
        key={device.id}
        device={device}
        name={deviceName(device, t)}
        titled={titled}
        mayManage={mayManage}
        report={report}
        asking={asking}
      />
    ) : (
      <p key={device.id} className={`${ui.cardDashed} ${ui.note}`}>
        {t('ownPanel.waiting', { device: deviceTitle(device, t, all.data?.items) })}
      </p>
    ),
  );

  if (controllers.length === 0 && own.length > 0) {
    return (
      <div className={styles.page}>
        <header className={ui.subhead}>
          <span className="label">{t('ownPanel.title')}</span>
        </header>
        {panels}
        <LeaveGuard unsaved={unsaved} onAsking={setAsking} />
      </div>
    );
  }

  if (controllers.length === 0) {
    return (
      <div className={styles.page}>
        <header className={ui.subhead}>
          <span className="label">{t('targets.title')}</span>
        </header>
        {waiting.length > 0 ? (
          waiting.map(device => (
            <p key={device.id} className={`${ui.cardDashed} ${ui.note}`}>
              {t('targets.waiting', { device: deviceTitle(device, t, all.data?.items) })}
            </p>
          ))
        ) : (
          <p className={`${ui.cardDashed} ${ui.note}`}>
            {t('targets.nothing')}{' '}
            <Link to="/claim" className={styles.addDevice}>
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
        {crumb ? (
          <Link to={controlPath(spaceId)} className={`mono ${ui.headLink}`}>
            {t('targets.backToPlan')}
          </Link>
        ) : null}
      </header>

      {controllers.map(({ device, configuration }, index) => (
        <Fragment key={device.id}>
          <Panel
            anchor={index === 0}
            grow={grow}
            device={device}
            stored={configuration}
            mayManage={mayManage}
            titled={controllers.length > 1}
            report={report}
            asking={asking}
          />
          {/* An AIR fan's speeds belong with the targets it follows. */}
          {device.type === 'fan' ? (
            <FanPanel device={device} name={deviceName(device, t)} titled={false} mayManage={mayManage} report={fanReport} asking={asking} />
          ) : null}
        </Fragment>
      ))}
      {panels}
      <LeaveGuard unsaved={unsaved} onAsking={setAsking} />
    </div>
  );
}

/** The hardware that has a panel of its own here instead of targets. */
const OWN_PANEL_TYPES = ['plug', 'light'];

function OwnPanelOf(props: React.ComponentProps<typeof PlugPanel>) {
  return props.device.type === 'plug' ? <PlugPanel {...props} /> : <LightPanel {...props} />;
}

/**
 * The state of one panel's editing: what the sliders stand at, which stored
 * document they were moved against, and the preset chip tapped last - which
 * says whether the targets are a drying room's, however the sliders were moved
 * after it.
 */
interface Edit {
  draft: TargetsDraft;
  against: DeviceConfiguration;
  chip: ClimateChoice | null;
}

/** Whether saving the edit would start or end a drying spell, which is something to save even where the sliders did not move. */
const dryingChangeOf = (chip: ClimateChoice | null, device: Device): 'starts' | 'ends' | null => {
  if (!chip || !device.control) return null;
  const dries = chip.stage === 'drying';
  return dries === device.control.drying ? null : dries ? 'starts' : 'ends';
};

/** What the last save sent, so the sliders stay where they were put until the device's document catches up. */
interface Sent {
  draft: TargetsDraft;
  at: DateTime;
}

function Panel({
  device,
  stored,
  mayManage,
  titled,
  report,
  asking,
  anchor,
  grow,
}: {
  device: Device;
  stored: DeviceConfiguration;
  mayManage: boolean;
  titled: boolean;
  report: (deviceId: string, entry: Unsaved | null) => void;
  /** Whether leaving the page is being asked about, which the bar then stands aside for. */
  asking: boolean;
  /** The first panel, whose chips a link to "#presets" scrolls to. */
  anchor: boolean;
  /** The grow standing here, where the diary is kept. */
  grow: GrowCard | null;
}) {
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

  // A draft holds until the stored targets move - so a save in flight does
  // not snap the sliders back, and a figure dialled in on the device itself
  // takes them over as soon as it arrives. A change to the rest of the
  // document - the energy-saving switch beside them - leaves the sliders where
  // they were put.
  const baseline = draftOf(stored);
  const live = edit && sameDraft(draftOf(edit.against), baseline) ? edit : null;
  const draft = live ? live.draft : baseline;
  const dirty =
    (!sameDraft(draft, baseline) && !(sent !== null && sameDraft(draft, sent.draft))) || dryingChangeOf(live?.chip ?? null, device) !== null;
  const tapped = live?.chip ?? null;
  const set = (next: TargetsDraft, chip: ClimateChoice | null = tapped) => setEdit({ draft: next, against: stored, chip });
  // A drying chip starts a drying spell and any other chip ends one; moving a slider alone leaves it as it is.
  const drying = device.control && tapped ? tapped.stage === 'drying' : undefined;
  const dryingChange = dryingChangeOf(tapped, device);

  const hasCo2 = hasCo2Sensor(device);
  // An AIR fan reads a temperature and a humidity, by its own day: no lamp, no
  // light hours and no CO2 of its own to set.
  const climateOnly = device.type === 'fan';
  const status = plan.data?.state.status ?? null;
  const heard = useHeardAt(device);
  const liveness = deviceLiveness(heard, now);
  const busy = save.isPending || move.isPending;
  const name = deviceName(device, t);

  // Saving over a running plan pauses it first: a plan that kept running would
  // write its step's targets over these within the hour. The errors of either
  // step are the mutations' own and are drawn from there.
  const commit = async (): Promise<boolean> => {
    try {
      if (status === 'running') await move.mutateAsync({ kind: 'pause', reason: t('targets.pauseReason') });
      await save.mutateAsync({ deviceId: device.id, configuration: withDraft(stored, draft, climateOnly), drying });
      setSent({ draft, at: serverNow() });
      // Saved, the chip has said what it had to: the drying spell is the device's now.
      setEdit(current => (current ? { ...current, chip: null } : current));
      return true;
    } catch {
      // Shown under the bar, from the mutation that refused.
      return false;
    }
  };

  // Handed up while there is something to lose, so that leaving the page asks
  // about it. The save is read through a ref, because the draft it sends is the
  // one standing when the question is answered and not when it was first asked.
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  // A link that names the chips - the climate preset of the place menu - lands on them once they are drawn.
  const { hash } = useLocation();
  const presets = useRef<HTMLDivElement>(null);
  const drawn = !plan.isPending && (plan.data !== undefined || isMissing(plan.error));
  useEffect(() => {
    if (anchor && drawn && hash === '#presets') presets.current?.scrollIntoView({ block: 'center' });
  }, [anchor, drawn, hash]);

  const unsaved = dirty && mayManage;
  useEffect(() => {
    if (!unsaved) return;
    report(device.id, { save: () => latest.current(), discard: () => setEdit(null) });
    return () => report(device.id, null);
  }, [unsaved, device.id, report]);

  const chosen = (chip: ClimateChoice): boolean => {
    const preset = presetOf(chip);
    return preset !== null && equalsPreset(draft, preset, hasCo2, climateOnly);
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
      <ControlState device={device} mayManage={mayManage} />

      <Block grouped label={t('targets.day')} help="dayNight" aside={<a href={`#${nightId}`}>{t('targets.toNight')}</a>}>
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
          aside={<Term topic="vpd">{vpd(draft.dayTemperature, draft.dayHumidity, 'day')}</Term>}
          disabled={readOnly}
          onChange={dayHumidity => set({ ...draft, dayHumidity })}
        />
        {climateOnly ? null : (
          <>
            <TargetRow
              id={`targets-${device.id}-light`}
              label={t('targets.light')}
              name={t('targets.aria.lightLimit')}
              value={draft.lightLimit}
              min={0}
              max={100}
              step={5}
              unit={t('targets.unit.percent')}
              help="lightLimit"
              disabled={readOnly}
              onChange={lightLimit => set({ ...draft, lightLimit })}
            />
            <LightsOnRow
              id={`targets-${device.id}-lights-on`}
              lightsOn={draft.lightsOn}
              lightsOff={lightsOffOf(draft)}
              offset={offsetOf(now, zone)}
              disabled={readOnly}
              onChange={lightsOn => set({ ...draft, lightsOn })}
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
          </>
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

      {/* Under the sliders rather than over them: what the tab is opened for is
          the figures the tent holds now, and a stage is one way of setting them. */}
      <div className={styles.presets} ref={anchor ? presets : undefined} id={anchor ? 'presets' : undefined}>
        <p className={ui.note}>
          {t('targets.prefill')}
          <Help topic="climatePreset" />
        </p>
        <Choices label={t('targets.presets')}>
          {CLIMATE_CHOICES.map(chip => (
            <Choice
              key={`${chip.stage}:${chip.preset ?? ''}`}
              chosen={chosen(chip)}
              disabled={readOnly}
              onChoose={() => {
                const preset = presetOf(chip);
                if (preset) set(prefilled(draft, preset), chip);
              }}
            >
              {climateChoiceName(t, chip)}
            </Choice>
          ))}
        </Choices>
        {/* The chips move the targets and nothing else; the grow's phase is
            moved in the grow, where the climate is offered beside it. */}
        {dryingChange ? (
          <p className={ui.note} role="status">
            {t(`targets.drying.${dryingChange}`)}
          </p>
        ) : null}
        {grow?.stage ? <p className={ui.note}>{t('targets.growStays', { name: grow.name, stage: t(`home.stage.${grow.stage}`) })}</p> : null}
      </div>

      <EnergySaving device={device} mayManage={mayManage} />

      {status === 'running' ? (
        <div className={`${ui.card} ${styles.planCard}`} data-status="running" role="status">
          <p className={styles.planText}>{t('targets.planRunning')}</p>
        </div>
      ) : status === 'paused' ? (
        <div className={`${ui.card} ${styles.planCard}`} data-status="paused" role="status">
          <p className={styles.planText}>
            {plan.data?.state.pauseReason ? t('targets.planPausedFor', { reason: plan.data.state.pauseReason }) : t('targets.planPaused')}
          </p>
          {mayManage ? (
            <>
              <button type="button" className={ui.button} disabled={busy} onClick={() => move.mutate({ kind: 'resume' })}>
                {t('targets.resume')}
              </button>
              <Help topic="resumePlan" />
            </>
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
          {t('space.control.applied.quiet', { offline: offlineLabel(heard, now, zone, true) })}
        </p>
      ) : null}

      {dirty && mayManage && !asking ? (
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
