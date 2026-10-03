import { CalendarRange } from 'lucide-react';
import type { DateTime } from 'luxon';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { controlPath } from '@/app/places';
import type { Device, DeviceConfiguration, GrowCard, PlanStep } from '@fg2/shared-types/v1';
import { useHome } from '@/api/home';
import { useDiaryLayer } from '@/api/layers';
import { serverNow } from '@/api/clock';
import { useDevices, useHeardAt, useLiveReads, useSaveConfiguration } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition } from '@/api/plans';
import { ageAttribute, deviceLiveness, offlineLabel } from '@/ui/age';
import { awaitingClimate, hasCo2Sensor, statesTargets } from '@/ui/climate-hardware';
import { Help } from '@/ui/Help';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { CLIMATE_CHOICES, climateChoiceName, type ClimateChoice } from '@/ui/presets';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { nowThere, CLOCK, useZone } from '@/ui/zone';
import { deviceTitle } from '../../devices/naming';
import { FanPanel } from '../devices/FanPanel';
import { LightPanel } from '../devices/LightPanel';
import { PlugPanel } from '../devices/PlugPanel';
import { useDeviceLive } from '../../cockpit/reads';
import { changedFields, heldOf, nowHoldingOf, ownedBy, runningStep, shapeOf } from './day-night';
import { DayNightTable } from './DayNightTable';
import { LightPlan } from './LightPlan';
import { LeaveGuard, type Unsaved } from './LeaveGuard';
import { ControlState, EnergySaving } from './Operation';
import { stepLightHours, stepLightsOn } from '../plan-edit';
import {
  draftOf,
  equalsPreset,
  offsetOf,
  prefilled,
  presetOf,
  sameDraft,
  wallClock,
  withDraft,
  type LightSchedule,
  type TargetsDraft,
} from './targets-draft';
import day from './DayNight.module.css';
import styles from './Targets.module.css';
import { deviceName } from '@/screens/devices/naming';
import { fieldValue } from '@/ui/advanced/field-values';

/**
 * The targets a tent is held at: what the Control tab opens on, unless a plan
 * is running and setting them itself.
 *
 * The figures stand in one table, the day's beside the night's under the light
 * schedule that decides between them (`DayNightTable`). A stage's figures are
 * only a starting point here, so the chips under the table prefill them and
 * write nothing, and one Save sends the whole document. A plan that is running
 * would put back what its step writes within the hour - the engine re-applies
 * the step it stands on - so saving one of those figures pauses it first and
 * says so beforehand, in the amber the app keeps for a state somebody chose;
 * moving what the step does not write leaves it running. Every device standing here that states
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
  // The panels whose figures stand somewhere nobody has saved, so that leaving the page asks first.
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
          {/* An AIR fan's mode comes first: at a fixed speed it follows no target, and its targets are not offered. */}
          {device.type === 'fan' ? (
            <FanPanel
              device={device}
              name={deviceName(device, t)}
              titled={controllers.length > 1}
              mayManage={mayManage}
              report={fanReport}
              asking={asking}
            />
          ) : null}
          {device.type === 'fan' && fieldValue(device, 'fanMode') === 'fixed' ? (
            <p className={`${ui.cardDashed} ${ui.note}`}>{t('fanSettings.fixedTargets')}</p>
          ) : (
            <Panel
              anchor={index === 0}
              grow={grow}
              device={device}
              stored={configuration}
              mayManage={mayManage}
              titled={controllers.length > 1 && device.type !== 'fan'}
              report={report}
              asking={asking}
            />
          )}
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
 * The state of one panel's editing: what the figures stand at, which stored
 * document they were moved against, and the preset chip tapped last - which
 * says whether the targets are a drying room's, however the figures were moved
 * after it.
 */
interface Edit {
  draft: TargetsDraft;
  against: DeviceConfiguration;
  chip: ClimateChoice | null;
}

/** Whether saving the edit would start or end a drying spell, which is something to save even where the figures did not move. */
const dryingChangeOf = (chip: ClimateChoice | null, device: Device): 'starts' | 'ends' | null => {
  if (!chip || !device.control) return null;
  const dries = chip.stage === 'drying';
  return dries === device.control.drying ? null : dries ? 'starts' : 'ends';
};

/** What the last save sent, so the figures stay where they were put until the device's document catches up. */
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
  const liveRead = useDeviceLive(device.id);
  const live = liveRead.data;
  const save = useSaveConfiguration();
  const move = usePlanTransition(device.id);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  // A draft holds until the stored targets move - so a save in flight does
  // not snap the figures back, and a figure dialled in on the device itself
  // takes them over as soon as it arrives. A change to the rest of the
  // document - the energy-saving switch beside them - leaves the figures where
  // they were put.
  const baseline = draftOf(stored);
  const editing = edit && sameDraft(draftOf(edit.against), baseline) ? edit : null;
  const draft = editing ? editing.draft : baseline;
  const dirty =
    (!sameDraft(draft, baseline) && !(sent !== null && sameDraft(draft, sent.draft))) || dryingChangeOf(editing?.chip ?? null, device) !== null;
  const tapped = editing?.chip ?? null;
  const set = (next: TargetsDraft, chip: ClimateChoice | null = tapped) => setEdit({ draft: next, against: stored, chip });
  // A drying chip starts a drying spell and any other chip ends one; moving a figure alone leaves it as it is.
  const drying = device.control && tapped ? tapped.stage === 'drying' : undefined;
  const dryingChange = dryingChangeOf(tapped, device);

  const hasCo2 = hasCo2Sensor(device);
  // An AIR fan reads a temperature and a humidity, by its own day: no lamp, no
  // light hours and no CO2 of its own to set.
  const climateOnly = device.type === 'fan';
  const status = plan.data?.state.status ?? null;
  const heard = useHeardAt(device);
  const liveness = deviceLiveness(heard, now);
  // Since when is said from the device's newest reading, as the page's own pill
  // says it, so the two lines on one screen do not name two different minutes.
  const spoke = useLiveReads([device.id]).measuredAt.get(device.id) ?? heard;
  const offline = liveness === 'offline' ? offlineLabel(spoke, now, zone, true) : null;
  const busy = save.isPending || move.isPending;
  const name = deviceName(device, t);
  const offset = offsetOf(now, zone);

  // What the targets are made of: what the device holds in the mode it runs,
  // or will hold once the chip tapped last and the light hours typed in are
  // saved - and, beside it, what it runs now, which is what "now" is about.
  const shape = shapeOf(device, draft, { drying: drying ?? device.control?.drying ?? false, climateOnly });
  const storedShape = shapeOf(device, baseline, { climateOnly });
  const holding = nowHoldingOf({
    device,
    shape: storedShape,
    stored: baseline,
    live,
    offline: offline !== null,
    awaiting: liveRead.isPending,
    now,
    clock: seconds => wallClock(seconds, offset),
  });

  // A running plan puts back what its step writes, within the hour - and only
  // that. Saving a figure it writes pauses it first, or the plan would undo
  // the save; moving what it does not write - the hour the light comes on, as
  // a rule - leaves it running. The errors of either step are the mutations'
  // own and are drawn from there.
  const step = runningStep(plan.data);
  const owned = ownedBy(step);
  const planSets = planScheduleOf(step, baseline, plan.data?.name ?? '');
  const pauses = status === 'running' && (dryingChange !== null || changedFields(draft, baseline).some(field => owned.has(field)));
  const commit = async (): Promise<boolean> => {
    try {
      if (pauses) await move.mutateAsync({ kind: 'pause', reason: t('targets.pauseReason') });
      // A spell begun from here stores what it holds in both halves; once a
      // fridge is drying the server keeps its stored day, so the day is sent as stored.
      const held = dryingChange === 'starts' ? heldOf(shape.regime) : 'both';
      await save.mutateAsync({ deviceId: device.id, configuration: withDraft(stored, draft, climateOnly, held), drying });
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

  const bar = useRef<HTMLDivElement>(null);
  const touched = useKeepInView(bar, dirty, editing?.draft ?? null);

  const chosen = (chip: ClimateChoice): boolean => {
    const preset = presetOf(chip);
    return preset !== null && equalsPreset(draft, preset, hasCo2, climateOnly);
  };

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
  const off = shape.regime === 'off';
  const planName = plan.data?.name ?? '';

  return (
    <section className={styles.panel} aria-label={name}>
      {titled ? <h2 className={styles.deviceName}>{name}</h2> : null}
      <RefreshFailed failedAt={plan.isError && plan.data ? plan.dataUpdatedAt : null} now={now} />

      {/* One card: what the mode leaves of the day, the light plan, and the
          figures under it. Switched off it is the line that says so alone. */}
      <div className={day.card} {...touched}>
        <ControlState device={device} mayManage={mayManage} />
        {off ? null : (
          <>
            <LightPlan
              device={device}
              shape={shape}
              storedShape={storedShape}
              draft={draft}
              baseline={baseline}
              set={next => set(next)}
              readOnly={readOnly}
              now={now}
              offset={offset}
              holding={holding}
              offline={offline}
              owned={owned}
              planSets={planSets}
            />
            {/* What a running plan writes, said over the figures it marks. */}
            {status === 'running' ? (
              <div className={day.section}>
                <p className={day.legend}>
                  {owned.size > 0 ? (
                    <>
                      <CalendarRange size={13} strokeWidth={2} className={day.planMark} aria-hidden />
                      <span>{t('targets.planTable.legend', { name: planName })}</span>
                    </>
                  ) : (
                    <span>{t('targets.planTable.ownsNothing', { name: planName })}</span>
                  )}
                </p>
              </div>
            ) : null}
            <DayNightTable
              device={device}
              shape={shape}
              storedShape={storedShape}
              draft={draft}
              baseline={baseline}
              set={next => set(next)}
              hasCo2={hasCo2}
              readOnly={readOnly}
              offset={offset}
              holding={holding}
              owned={owned}
              now={now}
            />
          </>
        )}
      </div>

      {status === 'paused' ? (
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

      {/* Under the table rather than over it: what the tab is opened for is
          the figures the tent holds now, and a stage is one way of setting
          them. Switched off there is nothing to prefill. */}
      {off ? null : (
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
      )}

      {/* Energy saving belongs to a day and night of the standard mode, which neither a drying spell nor control off is. */}
      {off || shape.regime === 'drying' ? null : <EnergySaving device={device} mayManage={mayManage} />}

      {readOnly ? <p className={ui.note}>{t('targets.readOnly')}</p> : null}

      {sent ? (
        <p className={`mono ${styles.sent}`} role="status">
          {t('targets.sentAt', { time: nowThere(sent.at, zone).toFormat(CLOCK) })}
          <span className={styles.sentNote}>{t('targets.sentNote')}</span>
        </p>
      ) : null}

      {offline !== null ? (
        <p className={`mono ${styles.quiet}`} {...ageAttribute(liveness)}>
          {t('space.control.applied.quiet', { offline })}
        </p>
      ) : null}

      {dirty && mayManage && !asking ? (
        // What a save does to a running plan stands in the bar beside the
        // button, where it is read before the tap rather than under the table.
        <div ref={bar} className={`${ui.card} ${styles.bar}`} data-pauses={(status === 'running' && pauses) || undefined}>
          <span className={styles.barText}>
            {busy
              ? t('targets.saving')
              : status === 'running'
                ? t(pauses ? 'targets.planTable.pauses' : 'targets.planTable.keeps', { name: planName })
                : t('targets.unsaved')}
          </span>
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

/**
 * The light schedule a running plan's step puts back within the hour, where
 * it differs from the one that runs: a step's light hours from the device's
 * hour, or a migrated step's own two times. "Licht an 08:00" with a mark
 * beside it said nothing of the 07:00 the plan would set again an hour later.
 */
const planScheduleOf = (step: PlanStep | null, runs: TargetsDraft, name: string): { name: string; schedule: LightSchedule } | null => {
  if (!step) return null;
  const on = stepLightsOn(step.settings);
  const hours = stepLightHours({ settings: step.settings, lightHours: step.lightHours ?? null });
  if (on === null && hours === null) return null;
  const schedule = { lightsOn: on ?? runs.lightsOn, lightHours: hours ?? runs.lightHours };
  return schedule.lightsOn === runs.lightsOn && schedule.lightHours === runs.lightHours ? null : { name, schedule };
};

/**
 * Keeps the figure somebody is changing clear of the save bar. The bar stands
 * over the foot of a phone's screen from the first change on, which is where a
 * row tapped near the bottom was: its own − and + went under the bar that its
 * first tap brought up. After each change the row last touched is scrolled up
 * out from under the bar if it is behind it - after a change only, so a page
 * scrolled on by hand is not pulled back on the next redraw.
 */
function useKeepInView(bar: React.RefObject<HTMLDivElement | null>, dirty: boolean, change: unknown) {
  const touched = useRef<HTMLElement | null>(null);
  const remember = (event: React.SyntheticEvent) => {
    const target = event.target as HTMLElement;
    touched.current = target.closest<HTMLElement>('[role="row"], [data-keep]') ?? target;
  };

  useLayoutEffect(() => {
    if (!dirty || !bar.current || !touched.current?.isConnected) return;
    const covers = bar.current.getBoundingClientRect().top;
    const bottom = touched.current.getBoundingClientRect().bottom;
    if (bottom > covers - 8) window.scrollBy({ top: bottom - covers + 16 });
  }, [bar, dirty, change]);

  return { onPointerDownCapture: remember, onFocusCapture: remember };
}
