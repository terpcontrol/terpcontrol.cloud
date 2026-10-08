import { CalendarRange } from 'lucide-react';
import type { DateTime } from 'luxon';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { controlPath } from '@/app/places';
import type { Device, DeviceConfiguration, GerminationChoices as ChoiceValues, GrowCard, PlanStep } from '@fg2/shared-types/v1';
import { GERMINATION_HUMIDITY } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { heardAt } from '@fg2/shared-types/v1-schemas/value-age.js';
import { useHome } from '@/api/home';
import { useDiaryLayer } from '@/api/layers';
import { serverNow } from '@/api/clock';
import { useDeviceLive, useDevices, useHeardAt, useLiveReads, useSaveConfiguration, useSocketTables } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition } from '@/api/plans';
import { ageAttribute, deviceLiveness, offlineLabel } from '@/ui/age';
import { awaitingClimate, hasCo2Sensor, statesTargets } from '@/ui/climate-hardware';
import { Help } from '@/ui/Help';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { CLIMATE_CHOICES, climateChoiceName, type ClimateChoice } from '@/ui/presets';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { offsetOf, wallClock } from '@/ui/wall-clock';
import { nowThere, CLOCK, useZone } from '@/ui/zone';
import { DeviceAdvanced } from '../../devices/DeviceAdvanced';
import { deviceName, deviceTitle } from '@/ui/naming';
import { FanPanel } from '../devices/FanPanel';
import { LightPanel } from '../devices/LightPanel';
import type { OwnPanelProps } from '../devices/OwnPanel';
import { PlugPanel } from '../devices/PlugPanel';
import { changedFields, heldOf, holdsHumidity, nowHoldingOf, ownedBy, runningStep, shapeOf } from './day-night';
import { DayNightTable } from './DayNightTable';
import { LightPlan } from './LightPlan';
import { LeaveGuard, type Unsaved } from './LeaveGuard';
import { useReportUnsaved } from './report-unsaved';
import { ControlState, EnergySaving } from './Operation';
import { AddDeviceNote } from '../AddDeviceNote';
import { GerminationChoices } from '../germination/GerminationChoices';
import { choicesOf, choicesSaid, useHumidifier } from '../germination/germination-choices';
import { stepLightHours, stepLightsOn } from '../plan-edit';
import { draftOf, equalsPreset, prefilled, presetOf, sameDraft, withDraft, type LightSchedule, type TargetsDraft } from './targets-draft';
import day from './DayNight.module.css';
import styles from './Targets.module.css';
import { fieldValue } from '@/ui/advanced/field-values';
import { targetFigure } from '@/ui/units';

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
        <DevicesAdvanced devices={devices} />
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
          <AddDeviceNote>{t('targets.nothing')}</AddDeviceNote>
        )}
        <DevicesAdvanced devices={devices} />
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
      <DevicesAdvanced devices={devices} />
      <LeaveGuard unsaved={unsaved} onAsking={setAsking} />
    </div>
  );
}

/**
 * Under the targets, the rest of what each device here is set to: the same
 * Erweitert its own panel under Geräte has, but for the mode the chips above
 * already set. Start leads here to change a value, and a compressor's rest or a
 * device's update channel is a value too, so nobody has to know that the
 * hardware has a page of its own to find them.
 */
function DevicesAdvanced({ devices }: { devices: Device[] }) {
  const { t } = useTranslation();
  const now = useNow();
  const all = useDevices();
  const ids = devices.map(device => device.id);
  const tables = useSocketTables(ids);
  const reads = useLiveReads(ids);

  return devices.map(device => (
    <DeviceAdvanced
      key={device.id}
      device={device}
      sockets={tables.tables.get(device.id)}
      offline={deviceLiveness(heardAt(device.state.lastSeenAt, reads.measuredAt.get(device.id) ?? null), now) === 'offline'}
      title={devices.length > 1 ? t('advanced.titleOf', { device: deviceTitle(device, t, all.data?.items) }) : undefined}
      besideTargets
    />
  ));
}

/** The hardware that has a panel of its own here instead of targets. */
const OWN_PANEL_TYPES = ['plug', 'light'];

function OwnPanelOf(props: OwnPanelProps) {
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
  /** What germination is to do about the humidity, where it was changed here. */
  choices: Partial<ChoiceValues> | null;
}

/**
 * Whether saving the edit would start or end one of the two stages that are a
 * mode of the device as well - drying, and germination in the dark - which is
 * something to save even where the figures did not move. The chip tapped last
 * decides: its own stage starts the spell, any other ends it.
 */
const spellChangeOf = (chip: ClimateChoice | null, device: Device, spell: 'drying' | 'germination'): 'starts' | 'ends' | null => {
  const control = device.control;
  if (!chip || !control) return null;
  const wanted = chip.stage === spell;
  const running = spell === 'drying' ? control.drying : !control.drying && control.mode === 'germination';
  return wanted === running ? null : wanted ? 'starts' : 'ends';
};

/** What the last save sent, so the figures stay where they were put until the device's document catches up. */
interface Sent {
  draft: TargetsDraft;
  at: DateTime;
  choices: ChoiceValues;
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
  const tapped = editing?.chip ?? null;
  const dryingChange = spellChangeOf(tapped, device, 'drying');
  const germinationChange = spellChangeOf(tapped, device, 'germination');
  // A drying chip starts a drying spell and any other chip ends one, and the
  // germination chip the same for germination in the dark; moving a figure
  // alone leaves both as they are.
  const drying = device.control && tapped ? tapped.stage === 'drying' : undefined;
  const germination = device.control && tapped ? tapped.stage === 'germination' : undefined;
  // What germination does about the humidity: the device's, with what was
  // changed here over it. It is a change to save only while the page shows it -
  // the device germinates, or the germination chip was tapped - and not once a
  // save has sent it and the device is still being read again.
  const humidifier = useHumidifier(device);
  const storedChoices = choicesOf(device);
  const choices: ChoiceValues = { ...storedChoices, ...(editing?.choices ?? {}) };
  const germinates = germination ?? (device.control?.mode === 'germination' && !device.control.drying);
  const differs = (one: ChoiceValues, other: ChoiceValues) =>
    one.warnTooHumid !== other.warnTooHumid || (humidifier && one.humidifierHolds !== other.humidifierHolds);
  const choicesChange = germinates && differs(choices, storedChoices) && !(sent !== null && !differs(choices, sent.choices));
  const dirty =
    (!sameDraft(draft, baseline) && !(sent !== null && sameDraft(draft, sent.draft))) ||
    dryingChange !== null ||
    germinationChange !== null ||
    choicesChange;
  const set = (next: TargetsDraft, chip: ClimateChoice | null = tapped) =>
    setEdit({ draft: next, against: stored, chip, choices: editing?.choices ?? null });
  const choose = (change: Partial<ChoiceValues>) =>
    setEdit({ draft, against: stored, chip: tapped, choices: { ...(editing?.choices ?? {}), ...change } });

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
  // A humidifier that holds in germination holds the night's humidity, which the table then shows.
  const shape = shapeOf(device, draft, {
    drying: drying ?? device.control?.drying ?? false,
    germination: germination ?? device.control?.mode === 'germination',
    climateOnly,
    humidified: humidifier && choices.humidifierHolds,
  });
  const storedShape = shapeOf(device, baseline, { climateOnly, humidified: humidifier && storedChoices.humidifierHolds });
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
  // A germination step that says what germination does about the humidity puts that back within the hour too.
  const setsByHand = dryingChange !== null || germinationChange !== null || changedFields(draft, baseline).some(field => owned.has(field));
  const pauses = status === 'running' && (setsByHand || (choicesChange && (step?.germinationChoices ?? null) !== null));
  const commit = async (): Promise<boolean> => {
    try {
      // The reason the plan card gives says what was done by hand: the targets, or only what germination does about the humidity.
      if (pauses) await move.mutateAsync({ kind: 'pause', reason: t(setsByHand ? 'targets.pauseReason' : 'targets.pauseReasonGermination') });
      // A spell begun from here stores what it holds in both halves; once a
      // fridge is drying the server keeps its stored day, so the day is sent as stored.
      const held = dryingChange === 'starts' ? heldOf(shape.regime) : 'both';
      // What germination does about the humidity goes with a save that germinates, as the page shows it.
      const germinationChoices = shape.regime === 'germination' ? choicesSaid(choices, humidifier) : undefined;
      await save.mutateAsync({
        deviceId: device.id,
        configuration: withDraft(stored, draft, climateOnly, held),
        drying,
        germination,
        germinationChoices,
      });
      setSent({ draft, at: serverNow(), choices });
      // Saved, the chip has said what it had to: the drying spell or the germination is the device's now.
      setEdit(current => (current ? { ...current, chip: null } : current));
      return true;
    } catch {
      // Shown under the bar, from the mutation that refused.
      return false;
    }
  };

  // A link that names the chips - the climate preset of the place menu - lands on them once they are drawn.
  const { hash } = useLocation();
  const presets = useRef<HTMLDivElement>(null);
  const drawn = !plan.isPending && (plan.data !== undefined || isMissing(plan.error));
  useEffect(() => {
    if (anchor && drawn && hash === '#presets') presets.current?.scrollIntoView({ block: 'center' });
  }, [anchor, drawn, hash]);

  useReportUnsaved(report, device.id, dirty && mayManage, { save: commit, discard: () => setEdit(null) });

  const bar = useRef<HTMLDivElement>(null);
  const touched = useKeepInView(bar, dirty, editing?.draft ?? null);

  // Germination is chosen by the dark it runs in as much as by its figures:
  // a lit device at 24 °C at night is not germinating, and a germinating one
  // whose idle figures happen to be the seedling's is not on the seedling climate.
  // Its humidity counts only where the table shows it, a humidifier holding it.
  const chosen = (chip: ClimateChoice): boolean => {
    const preset = presetOf(chip);
    if (preset === null || (chip.stage === 'germination') !== (shape.regime === 'germination')) return false;
    const shown = chip.stage === 'germination' && !holdsHumidity(shape) ? { ...preset, nightHumidity: null } : preset;
    return equalsPreset(draft, shown, hasCo2, climateOnly);
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
            {/* Germination regulates no humidity of its own; what it does about it is the grower's to say. */}
            {shape.regime === 'germination' ? (
              <div className={day.section}>
                <GerminationChoices value={choices} onChange={choose} humidifier={humidifier} humidity={draft.nightHumidity} disabled={readOnly} />
              </div>
            ) : null}
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
          {dryingChange || germinationChange ? (
            <p className={ui.note} role="status">
              {t(dryingChange ? `targets.drying.${dryingChange}` : `targets.germination.${germinationChange}`, {
                humidity: targetFigure(GERMINATION_HUMIDITY, 'humidity'),
              })}
            </p>
          ) : null}
          {grow?.stage ? <p className={ui.note}>{t('targets.growStays', { name: grow.name, stage: t(`home.stage.${grow.stage}`) })}</p> : null}
        </div>
      )}

      {/* Energy saving belongs to a day and night of the standard mode, which neither a drying spell, germination nor control off is. */}
      {off || shape.regime === 'drying' || shape.regime === 'germination' ? null : <EnergySaving device={device} mayManage={mayManage} />}

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
