import { useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Device,
  Entry,
  EntryCreate,
  EntryReading,
  EntryUpdate,
  EntryValuesDraft,
  GrowListItem,
  GrowthStage,
  MeasurementDefinition,
} from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useDevices } from '@/api/devices';
import { correctEntry, diaryChanged, startPhase, takeEntryBack, useRecentEntries, writeEntry } from '@/api/entries';
import { useGrow } from '@/api/grows';
import { useHome } from '@/api/home';
import type { Translate } from '@/i18n/i18n';
import { deviceTitle } from '@/ui/naming';
import { MeasureSheet } from '@/screens/grow/measurements/MeasureSheet';
import { NewGrowSheet } from '@/screens/grow/new/NewGrowSheet';
import { ClimatePick } from '@/screens/grow/ClimatePick';
import { assetTitle } from '@/screens/grow/scheme';
import { climateRequest, defaultPick, KEEP_CLIMATE, usePlaceController, type PhaseClimate } from '@/screens/grow/phase-climate';
import { looseFigure, typedFigure } from '@/ui/figures';
import { maintenanceSpans, parksLine, VISIT_MINUTES } from '@/ui/maintenance';
import { useMayManage } from '@/ui/session-access';
import { Choice, Choices } from '@/ui/SheetParts';
import { STAGES } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
import { dayAt, dosesOf, lastCan, litresOf, nextStage, readingsOf, schemeStep, startsAfter, stoppedAfter } from './defaults';
import { about, lineLabel, occurredAt } from './lines';
import { useLog, type LogTarget, type TileKind } from './log-context';
import { Moment } from './Moment';
import { Sheet } from '@/ui/Sheet';
import styles from './Log.module.css';

/**
 * The details behind a tile: the water, the doses that follow from it, the
 * readings taken while pouring, and the words.
 *
 * It is the same view for every kind that has any, because they differ in which
 * of those four they show and in nothing else. The doses are worked out with
 * the contract's own function, so what is drawn here is what the server will
 * store; nothing is sent with them, and the server reads the grid again.
 *
 * A line written here goes through the queue like a tap does - sheet closed,
 * toast up, Undo for five seconds. Correcting a line that already exists does
 * not: it waits for the server, because there is nothing to undo afterwards.
 *
 * When it happened stands in the sheet's corner from the start (`Moment`): a
 * line written down after the fact - this morning's watering, yesterday's
 * reading - is dated there, and what the sheet then draws follows that moment
 * rather than this one, down to which week of the scheme the doses come from.
 */

/** The grow's own name for a can of water, which the water row already is: it is not asked for twice. */
const WATER_KEY = 'water_l';

/** How many readings a kind shows fields for before the rest become chips. */
const FIELDS_SHOWN = 3;

const LITRE_STEP = 0.5;

export function EntryDetails({ kind, target, entry, onClose }: { kind: TileKind; target: LogTarget; entry: Entry | null; onClose: () => void }) {
  // Measuring has a sheet of its own: it is the one tile whose fields are the
  // grow's own definitions, and it is used with one hand in front of a plant.
  // Correcting a line that already exists stays here, where every kind is
  // corrected the same way - a keypad that rewrote a round of readings taken
  // across several plants would be a second way to say what the line already
  // says.
  if (kind === 'measurement' && !entry) return <MeasureSheet target={target} onClose={onClose} />;

  return <Details kind={kind} target={target} entry={entry} onClose={onClose} />;
}

function Details({ kind, target, entry, onClose }: { kind: TileKind; target: LogTarget; entry: Entry | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { log } = useLog();
  const client = useQueryClient();
  const { data: grow } = useGrow(target.growId);
  const { data: recent } = useRecentEntries(target.growId, target.spaceId);

  // What a new visit line would put into maintenance mode, read only when that
  // is the line being written: the panel below names it, and the button says how
  // many it reaches.
  const quietens = useQuietened(kind === 'visit' && !entry ? (target.standsIn ?? target.spaceId) : null);

  const definitions = (grow?.measurements ?? []).filter(measurement => measurement.key !== WATER_KEY);
  // The same can the tile offers, so opening the details never changes the line a tap would have written.
  const opensOn = kind === 'water' || kind === 'feed' ? lastCan(recent?.items ?? [], kind) : null;

  // When the line says it happened, or null where nobody said: a new line left
  // alone is "now", which is the server's own default, and a correction that
  // did not touch its moment keeps the instant it already had.
  const [dated, setDated] = useState<Date | null>(null);
  const said = dated ?? (entry ? new Date(entry.occurredAt) : null);
  const at = said ?? serverNow().toJSDate();
  const [litres, setLitres] = useState<number | null>(entry ? litresOf(entry) : opensOn);
  const [readings, setReadings] = useState<Record<string, string>>(() => typed(readingsOf(entry)));
  const [shown, setShown] = useState<string[]>(() => firstFields(definitions, readingsOf(entry)));
  const [text, setText] = useState(entry?.text ?? '');
  const [stage, setStage] = useState<GrowthStage | null>(nextStage(grow));
  /**
   * Whether the phase moves the tent's climate too: asked beside the stage, and
   * kept until the stage changes. Null until somebody picks, because what it
   * starts on depends on the device there (`defaultPick`).
   */
  const [picked, setClimate] = useState<PhaseClimate | null>(null);
  const placeController = usePlaceController(target.spaceId ?? target.standsIn);
  const climate = picked ?? (stage ? defaultPick(stage, placeController) : KEEP_CLIMATE);
  const [saving, setSaving] = useState(false);
  /** Which of the two writes went wrong, so the line under the button says the right thing. */
  const [failed, setFailed] = useState<'save' | 'back' | null>(null);
  const [askingBack, setAskingBack] = useState(false);
  /** The new-grow sheet takes this one's place once it is opened, rather than standing over it. */
  const [startingGrow, setStartingGrow] = useState(false);

  const step = schemeStep(grow, at);
  // What the line will say it is: the day it is dated to, not the day it is being written on.
  const filed = said ? { ...target, dayNumber: dayAt(grow, target, said) } : target;
  const showsWater = kind === 'water' || kind === 'feed';
  const showsReadings = kind === 'water' || kind === 'feed' || kind === 'measurement';
  const showsText = kind === 'note' || kind === 'training';
  // A new line about stepping in is not asked when it was: the quarter of an
  // hour of quiet it buys starts when it is saved, so a line dated to yesterday
  // would park the hardware today and say it happened then. An existing one is a
  // plain diary line by the time it is corrected - the window it opened has long
  // closed and nothing here reopens it - so its moment is free.
  const fixedNow = kind === 'visit' && entry === null;
  const doses = dosesOf(grow, litres, at);

  const values = (): EntryValuesDraft => {
    const taken = readingsFrom(readings, shown, definitions, target);
    switch (kind) {
      case 'water':
        return { kind: 'water', litres, readings: taken };
      case 'feed':
        return { kind: 'feed', litres, readings: taken };
      case 'measurement':
        return { kind: 'measurement', readings: taken };
      case 'training':
        return { kind: 'training' };
      case 'visit':
        return { kind: 'visit' };
      default:
        return { kind: 'note' };
    }
  };

  /** A phase is not an entry: it is written as the grow's phase, and the diary line follows from it. */
  const savePhase = async () => {
    if (!target.growId || !stage) return;
    setSaving(true);
    setFailed(null);
    try {
      await startPhase(target.growId, { stage, ...climateRequest(climate, stage), ...(dated ? { startedAt: occurredAt(dated).occurredAt } : {}) });
      diaryChanged(client);
      // A phase moves the devices there too - their targets, work mode and stage alarms - and the phase sheet reads them.
      void client.invalidateQueries({ queryKey: ['devices'] });
      onClose();
    } catch {
      setSaving(false);
      setFailed('save');
    }
  };

  const correct = async () => {
    if (!entry) return;
    setSaving(true);
    setFailed(null);
    try {
      const body: EntryUpdate = { ...about(target), ...occurredAt(dated), text: showsText ? text : entry.text, values: values() };
      await correctEntry(entry.id, body);
      diaryChanged(client);
      onClose();
    } catch {
      setSaving(false);
      setFailed('save');
    }
  };

  /**
   * Taking the line out of the diary altogether, which is what a reading typed
   * against the wrong plant or a watering that never happened asks for. It is
   * asked about first: the toast's Undo is a slip caught in five seconds, this
   * is somebody deciding days later, and the two deserve different care.
   */
  const takeBack = async () => {
    if (!entry) return;
    setSaving(true);
    setFailed(null);
    try {
      await takeEntryBack(entry.id);
      diaryChanged(client);
      onClose();
    } catch {
      setSaving(false);
      setFailed('back');
    }
  };

  const save = () => {
    if (kind === 'phase') return void savePhase();
    if (entry) return void correct();

    const body: EntryCreate = { kind, ...about(target), ...occurredAt(dated), text: showsText && text ? text : undefined, values: values() };
    // Stepping in is the one line here whose Undo would only be half of one: the
    // row goes and the devices stay parked for the rest of the quarter of an
    // hour, so the toast does not offer it. The panel above said as much before
    // the tap, which is where a consequence that cannot be taken back belongs.
    log({ label: lineLabel(t, kind, filed), details: { kind, target }, send: () => writeEntry(body), undoable: kind !== 'visit' });
  };

  const add = (key: string) => setShown(current => [...current, key]);

  // Starting a grow answers the question this sheet could not: one sheet at a
  // time, in place, the way a preset that finds nothing growing opens the same
  // one.
  if (startingGrow) return <NewGrowSheet spaceId={target.spaceId ?? target.standsIn} onClose={onClose} />;

  return (
    <Sheet title={title(t, kind, step?.week ?? null)} corner={<Moment at={said} onChange={setDated} fixed={fixedNow} />} onClose={onClose}>
      {/* Which grid the doses come from sits with what the line is about: the corner is the moment's. */}
      <p className={`mono ${styles.subject}`}>{[lineLabel(t, kind, filed), kind === 'feed' ? schemeLine(grow) : ''].filter(Boolean).join(' · ')}</p>

      {showsWater ? (
        <div className={`${ui.card} ${styles.waterRow}`}>
          <span className={styles.waterLabel}>{t('log.water')}</span>
          <button type="button" className={styles.step} onClick={() => setLitres(next(litres, -LITRE_STEP))} aria-label={t('log.less')}>
            <Minus size={16} strokeWidth={2} aria-hidden />
          </button>
          <span className={`figure ${styles.waterFigure}`}>{litres === null ? '—' : t('log.litres', { litres: looseFigure(litres) })}</span>
          <button type="button" className={styles.step} onClick={() => setLitres(next(litres, LITRE_STEP))} aria-label={t('log.more')}>
            <Plus size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : null}

      {kind === 'feed' ? (
        <div className={`${ui.card} ${styles.doses}`}>
          {step ? (
            step.amounts.map(amount => {
              const dose = doses.find(one => one.productKey === amount.productKey);
              const from = amount.value === null ? startsAfter(grow, amount.productKey, step.week) : null;
              const until = amount.value === null && from === null ? stoppedAfter(grow, amount.productKey) : null;
              return (
                <div key={amount.productKey} className={styles.dose} data-off={amount.value === null}>
                  <span className={styles.doseName}>{amount.name}</span>
                  <span className={`mono ${styles.doseRate}`}>
                    {amount.value === null
                      ? from !== null
                        ? t('log.startsIn', { week: from })
                        : until === null || until >= step.week
                          ? ''
                          : t('log.stopsAfter', { week: until })
                      : `${amount.value} ${amount.unit}`}
                  </span>
                  <span className={`figure ${styles.doseAmount}`}>{dose ? `${looseFigure(dose.amount)} ${dose.unit}` : '—'}</span>
                </div>
              );
            })
          ) : (
            <p className={ui.note}>{t('log.noScheme')}</p>
          )}
          <p className={`${ui.note} ${styles.mixNote}`}>{t('log.mixOrder')}</p>
        </div>
      ) : null}

      {showsReadings ? (
        <>
          <div className={styles.fields}>
            {shown.map(key => {
              const definition = definitions.find(one => one.key === key);
              return (
                <label key={key} className={`${ui.card} ${styles.field}`}>
                  <span className={styles.fieldName}>{definition?.name ?? key}</span>
                  <input
                    className={`figure ${styles.fieldInput}`}
                    inputMode="decimal"
                    value={readings[key] ?? ''}
                    placeholder={definition?.unit || undefined}
                    onChange={event => setReadings(current => ({ ...current, [key]: event.target.value }))}
                  />
                </label>
              );
            })}
          </div>
          {definitions.length > shown.length ? (
            <p className={`mono ${styles.more}`}>
              <span className="label">{t('log.measurements')}</span>
              {definitions
                .filter(definition => !shown.includes(definition.key))
                .map(definition => (
                  <button key={definition.key} type="button" className={`${ui.chip} ${styles.addField}`} onClick={() => add(definition.key)}>
                    + {definition.name}
                  </button>
                ))}
            </p>
          ) : null}
        </>
      ) : null}

      {showsText ? (
        <textarea
          className={`${ui.input} ${styles.text}`}
          rows={3}
          value={text}
          placeholder={t(kind === 'note' ? 'log.notePlaceholder' : 'log.trainingPlaceholder')}
          onChange={event => setText(event.target.value)}
        />
      ) : null}

      {kind === 'phase' ? (
        <Stages
          grow={grow}
          stage={stage}
          onPick={next => {
            setStage(next);
            setClimate(null);
          }}
          spaceId={target.spaceId ?? target.standsIn}
          onStartGrow={() => setStartingGrow(true)}
        />
      ) : null}
      {kind === 'phase' && grow && stage ? (
        <div className={styles.climate}>
          <ClimatePick stage={stage} spaceId={target.spaceId ?? target.standsIn} value={climate} onChange={setClimate} />
          {/* A phase dated back starts back then in the diary; the devices can only be told now. */}
          {dated && climate.climate ? <p className={ui.note}>{t('log.moment.climateNow')}</p> : null}
        </div>
      ) : null}

      {kind === 'visit' && !entry ? <WhatItQuietens quietens={quietens} /> : null}

      {failed ? (
        <p className={ui.problem} role="alert">
          {t(failed === 'back' ? 'log.undoFailed' : 'log.saveFailed')}
        </p>
      ) : null}

      <button
        type="button"
        className={`${ui.button} ${ui.primary} ${styles.save}`}
        onClick={save}
        disabled={saving || (kind === 'phase' && !stage) || quietens.isPending}
      >
        {saveLabel(t, kind, entry, filed, step !== null, quietens.devices?.length ?? null)}
      </button>

      {/* Only a line somebody wrote: what a device or the server recorded is
          not theirs to take back, and the server refuses it. */}
      {entry && entry.source === 'human' ? (
        <div className={styles.takingBack}>
          {askingBack ? (
            <>
              <p className={ui.note}>{t('log.takeBackAsk')}</p>
              <div className={styles.takeBackRow}>
                <button type="button" className={`${ui.button} ${ui.danger}`} disabled={saving} onClick={() => void takeBack()}>
                  {t('log.takeBackYes')}
                </button>
                <button type="button" className={ui.button} onClick={() => setAskingBack(false)}>
                  {t('log.cancel')}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className={`${ui.button} ${ui.dangerInk}`} disabled={saving} onClick={() => setAskingBack(true)}>
              {t('log.takeBack')}
            </button>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

/** What a visit line is about to quieten: where it reaches, and what stands there. */
interface Quietened {
  /** The place's own name, so the panel says where rather than "here". */
  name: string | null;
  /** What stands there; null while the list has not been read, or where nothing was asked. */
  devices: Device[] | null;
  /** Every device of the account, which is what says whether a name needs the tail of its id. */
  among: Device[];
  isPending: boolean;
  failed: boolean;
}

/**
 * The hardware a visit line would park.
 *
 * The server quietens every device whose space the line names - the place
 * itself, or the place a grow it is about stands in - so the same rule is asked
 * of the same list here, and what the panel names is what the request will
 * reach. It is read only while a visit is being written: the other seven tiles
 * have no business reading the fleet, so they ask for nothing and this answers
 * nothing.
 */
const useQuietened = (spaceId: string | null): Quietened => {
  const home = useHome();
  const devices = useDevices(spaceId !== null);
  const card = (home.data?.spaces ?? []).find(one => one.spaceId === spaceId) ?? null;

  return {
    name: card?.name ?? null,
    devices: spaceId === null || !devices.data ? null : devices.data.items.filter(device => device.spaceId === spaceId),
    among: devices.data?.items ?? [],
    isPending: spaceId !== null && devices.isPending,
    failed: spaceId !== null && devices.isError,
  };
};

/**
 * What stepping in is about to do, said before it is done.
 *
 * The line itself is the smaller half: saving it puts every device standing in
 * the place into maintenance mode for a quarter of an hour, which is a command
 * on real hardware and is not what "in here for 15 minutes" sounds like. So the
 * panel names the place, names each device by the name its own row carries, and
 * says that the diary line can be taken back afterwards while the quiet cannot.
 *
 * A place with nothing standing in it says so rather than promising an effect it
 * will not have, and a list that could not be read says that too - the rule
 * still holds for whatever stands there, and a panel that stayed silent would be
 * the very thing this replaces.
 *
 * What each device stops is said of that device and not of the place. The
 * sentence over the list used to promise a heater, a dehumidifier and a CO2
 * valve wherever the tile was opened, and the list directly under it read "Fan ·
 * 520107" - hardware with none of the three, whose firmware drops the order
 * without a word. Only a controller and a fridge park anything; everything else
 * goes quiet in the cloud and goes on driving exactly as it was.
 */
function WhatItQuietens({ quietens }: { quietens: Quietened }) {
  const { t } = useTranslation();
  const { name, devices, among, isPending, failed } = quietens;
  const where = { name: name ?? t('log.visit.hereFallback'), ...maintenanceSpans(VISIT_MINUTES) };

  if (isPending) return <p className={ui.note}>{t('log.visit.reading', where)}</p>;
  if (failed || devices === null) return <p className={ui.note}>{t('log.visit.unreadable', where)}</p>;
  if (devices.length === 0) return <p className={ui.note}>{t('log.visit.nothingThere', where)}</p>;

  return (
    <div className={styles.quietens}>
      <p className={ui.note}>{t('log.visit.parks', { ...where, count: devices.length })}</p>
      <ul className={`mono ${styles.quietensList}`}>
        {devices.map(device => (
          <li key={device.id}>
            <span>{deviceTitle(device, t, among)}</span>
            <span className={styles.quietensParks}>
              {' — '}
              {parksLine(t, device)}
            </span>
          </li>
        ))}
      </ul>
      <p className={ui.note}>{t('log.visit.notUndone', where)}</p>
    </div>
  );
}

/**
 * The six stages, with the one the grow is in named and the next one already
 * picked - and, where there is no grow to give a phase to, the way to the one
 * thing that would make the question answerable.
 *
 * The screens that invite somebody here are the reason for that second half. A
 * place with nothing growing in it draws a "+ Grow" chip, and the chip opens
 * this tile: with only the sentence it is a door onto a wall, and the sentence
 * is true but useless, because what the person asked for was a grow and this
 * says they cannot have a phase. So the offer stands beside it whenever the
 * place really has nothing growing and the reader may start one - not for a
 * place that has a grow the line was simply not pointed at, where the way on is
 * the grow's own chip a thumb's width away.
 */
function Stages({
  grow,
  stage,
  onPick,
  spaceId,
  onStartGrow,
}: {
  grow: GrowListItem | undefined;
  stage: GrowthStage | null;
  onPick: (stage: GrowthStage) => void;
  spaceId: string | null;
  onStartGrow: () => void;
}) {
  const { t } = useTranslation();
  const home = useHome();
  const mayManage = useMayManage(spaceId);
  const current = grow?.summary.stage ?? null;
  const card = (home.data?.spaces ?? []).find(one => one.spaceId === spaceId) ?? null;
  const nothingGrowsThere = card !== null && card.grow === null;

  if (!grow)
    return (
      <div className={styles.noGrow}>
        <p className={ui.note}>{t('log.phaseNeedsGrow')}</p>
        {nothingGrowsThere && mayManage ? (
          <button type="button" className={ui.button} onClick={onStartGrow}>
            {t('log.startGrowHere', { name: card.name })}
          </button>
        ) : null}
      </div>
    );

  return (
    <Choices label={t('log.tile.phase')}>
      {STAGES.map(one => (
        <Choice key={one} chosen={one === stage} onChoose={() => onPick(one)}>
          {t(`home.stage.${one}`)}
          {one === current ? ` · ${t('log.now')}` : ''}
        </Choice>
      ))}
    </Choices>
  );
}

const title = (t: Translate, kind: TileKind, week: number | null): string =>
  kind === 'feed' && week !== null ? t('log.feedWeek', { week }) : t(`log.tile.${kind}`, { minutes: VISIT_MINUTES });

/** "Biobizz · Light·Mix": which grid the doses come from, in the words the grow stores it under. */
const schemeLine = (grow: GrowListItem | undefined): string => {
  const origin = grow?.scheme?.origin;
  if (!origin) return '';
  const name = origin.type === 'asset' ? assetTitle(origin.assetId) : origin.schemeId;

  // A medium the shipped grid names by its key ("light_mix") is already in the grid's title, and a key is never shown.
  const medium = grow?.scheme?.plantType;
  return [name, medium && !/^[a-z0-9_]+$/.test(medium) ? medium : null].filter(Boolean).join(' · ');
};

/**
 * What the button says it will do. Stepping in says how much hardware it is
 * about to quieten, because that is the part of it a person is agreeing to; with
 * nothing standing there it is an ordinary line and says so.
 */
const saveLabel = (t: Translate, kind: TileKind, entry: Entry | null, target: LogTarget, planned: boolean, quietens: number | null): string => {
  if (entry) return t('log.saveCorrection');
  if (kind === 'feed' && planned) return t('log.logAsPlanned');
  if (kind === 'visit' && quietens) return t('log.visit.save', { count: quietens });
  return target.dayNumber === null ? t('log.save') : t('log.saveDay', { day: target.dayNumber });
};

/** Never below one step: a watering of zero litres is not a watering, it is an unanswered question. */
const next = (litres: number | null, by: number): number => Math.max(LITRE_STEP, Math.round(((litres ?? 0) + by) / LITRE_STEP) * LITRE_STEP);

const typed = (readings: EntryReading[]): Record<string, string> =>
  Object.fromEntries(readings.map(reading => [reading.key, looseFigure(reading.value)]));

/** The fields a kind opens with: what the line already says, else the first few the grow measures. */
const firstFields = (definitions: MeasurementDefinition[], readings: EntryReading[]): string[] =>
  readings.length > 0 ? readings.map(reading => reading.key) : definitions.slice(0, FIELDS_SHOWN).map(definition => definition.key);

/**
 * What was typed, as readings. A field left empty is not a reading of nothing,
 * so it is left out; a per-plant definition on a line about one plant carries
 * that plant, and on a line about the whole grow carries none.
 */
const readingsFrom = (typedIn: Record<string, string>, shown: string[], definitions: MeasurementDefinition[], target: LogTarget): EntryReading[] =>
  shown.flatMap(key => {
    const value = typedFigure(typedIn[key] ?? '');
    if (value === null) return [];
    const perPlant = definitions.find(definition => definition.key === key)?.perPlant ?? false;

    return [{ key, value, plantId: perPlant ? (target.plantIds[0] ?? null) : null }];
  });
