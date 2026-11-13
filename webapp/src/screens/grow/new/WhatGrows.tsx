import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { GerminationChoices as Choices, GrowthStage } from '@fg2/shared-types/v1';
import { GERMINATION_HUMIDITY } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { serverNow } from '@/api/clock';
import { useGrows } from '@/api/grows';
import { useSpaces } from '@/api/spaces';
import { GROW } from '@/app/places';
import { GerminationChoices } from '@/screens/control/germination/GerminationChoices';
import { choicesOf, useHumidifier } from '@/screens/control/germination/germination-choices';
import { usePlaceStage } from '@/screens/start/stage';
import { DAY_MS, dayOf, momentOn } from '@/ui/days';
import { unbroken } from '@/ui/figures';
import { Refused } from '@/ui/PageState';
import { stageChoiceName } from '@/ui/presets';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import { usePlaceController } from '../phase-climate';
import { growPlaces } from '../placement';
import { growBody, growIn, recordsOnly, START_STAGES, suggestedName } from './new-grow';
import { useStartGrow } from './start-grow';
import styles from './NewGrow.module.css';

type Since = 'today' | 'week' | 'date';

/** "No fixed place" in the list of places. */
const NOWHERE = '';

/**
 * "Was wächst hier?" - the one form a grow is started with, behind every
 * "Grow starten" and "+ Neuer Grow": what it is, since when, how many, where
 * - asked only where the caller names no place - and the phase it is in.
 * Everything else has an answer that can wait and is changed on the grow's own
 * page: a feeding scheme, the strains by name, an autoflower.
 *
 * It opens on the stage the place is on - read off its device (`usePlaceStage`),
 * or the one a step earlier in the same sitting put it on (`stage`) - and waits
 * for that answer rather than choosing before it. Where nothing says, it opens
 * on growth: a tent that already regulates rarely holds seeds.
 *
 * A stage the form only opened on is recorded and moves nothing. A stage the
 * grower chose puts the place's controller on its climate, and then the button
 * says so - except seeds beside plants already growing there, whose darkness
 * is not theirs (`recordsOnly`). Where that climate is germination's, the form
 * asks what germination does about the humidity, as every way of setting
 * germination does - of the device the climate preset is taken on
 * (`usePlaceController`) - and only what was moved is sent.
 *
 * Drawn on a page the button ends the form; as a `sheet` it is the sheet's
 * foot, which stands while the questions scroll.
 */
export function WhatGrows({
  spaceId: fixed = null,
  stage: given,
  onStarting,
  onStarted,
  submitClass,
  sheet,
}: {
  /** The place the form was opened for; null where it asks. */
  spaceId?: string | null;
  /** The stage the place was put on a moment ago, which its device may not say yet. */
  stage?: GrowthStage | null;
  /** The form was sent: from here on the grow may exist, whatever the page around the form reads next. */
  onStarting?: () => void;
  onStarted: (growId: string, spaceId: string | null) => void;
  submitClass?: string;
  /** The sheet the form is asked on, where it is one. */
  sheet?: Omit<ComponentProps<typeof Sheet>, 'children' | 'actions'>;
}) {
  const { t } = useTranslation();
  const form = useId();
  const zone = useZone();
  const grows = useGrows();
  const spaces = useSpaces(fixed === null);
  const { start, busy, refused } = useStartGrow();
  const [name, setName] = useState('');
  const [since, setSince] = useState<Since>('today');
  const [date, setDate] = useState(() => serverNow().toJSDate());
  const [count, setCount] = useState(1);
  const [picked, setStage] = useState<GrowthStage | null>(null);
  const [where, setWhere] = useState<string | null>(null);
  const [germination, setGermination] = useState<Partial<Choices>>({});

  const places = growPlaces(spaces.data?.items ?? []);
  const running = grows.data?.items ?? [];
  // Asked for, the first free place stands chosen: defaulting into a flowering tent would put a second grow in it.
  const spaceId = fixed ?? (where === null ? (places.find(one => growIn(running, one.id) === null)?.id ?? null) : where || null);
  const onPlace = usePlaceStage(spaceId);
  const on = given ?? onPlace;
  const controller = usePlaceController(spaceId);
  const opened: GrowthStage | null = on === undefined ? null : on && START_STAGES.includes(on) ? on : 'vegetative';
  const stage = picked ?? opened;
  const climate = picked !== null && picked !== on && controller !== null && !recordsOnly(picked, spaceId ? growIn(running, spaceId) : null);
  const germinates = climate && stage === 'germination';
  // Asked of the place's sockets only once the choices are on the form.
  const humidifier = useHumidifier(germinates ? controller : null);
  // The choices open under the stage that was tapped, which on a short screen is behind the sheet's foot: they are
  // brought into view, and again when the humidifier's switch joins them.
  const choices = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (germinates) choices.current?.scrollIntoView?.({ block: 'nearest' });
  }, [germinates, humidifier]);

  const submit = async () => {
    // Not before the place has said which stage it is on: what is chosen is told apart from it.
    if (stage === null || opened === null) return;
    const now = serverNow().toJSDate();
    const startedAt = since === 'today' ? now : since === 'week' ? new Date(now.getTime() - 7 * DAY_MS) : date;
    const typed = name.trim();
    const body = growBody(
      { name: typed || suggestedName(running, spaceId, t('grow.new.firstName')), strain: typed || t('grow.new.unnamedStrain'), count },
      spaceId,
      startedAt,
    );
    onStarting?.();
    try {
      const germinationChoices = germinates && Object.keys(germination).length > 0 ? germination : undefined;
      onStarted(await start({ body, stage, startedAt, climate, germinationChoices }), spaceId);
    } catch {
      // The refusal is drawn under the fields; what already stands is not written again on the next tap.
    }
  };

  const button = (
    <>
      <Refused error={refused} />
      <button
        type="submit"
        form={form}
        className={`${submitClass ?? `${ui.button} ${ui.primary}`} ${styles.start}`}
        disabled={busy || grows.isPending || opened === null || (fixed === null && spaces.isPending)}
      >
        {busy
          ? t('grow.new.starting')
          : climate && stage
            ? t('grow.new.startAndSet', { climate: unbroken(stageChoiceName(t, stage)) })
            : t('home.invite.startGrow')}
      </button>
    </>
  );

  const questions = (
    <form
      id={form}
      className={styles.whatGrows}
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className={styles.field}>
        {t('start.grow.name')}
        <input className={ui.input} value={name} autoComplete="off" onChange={event => setName(event.target.value)} />
      </label>
      <div className={styles.fieldPair}>
        <label className={styles.field}>
          {t('start.grow.since')}
          <select className={ui.input} value={since} onChange={event => setSince(event.target.value as Since)}>
            <option value="today">{t('start.grow.today')}</option>
            <option value="week">{t('start.grow.week')}</option>
            <option value="date">{t('start.grow.date')}</option>
          </select>
        </label>
        <label className={styles.field}>
          {t('grow.new.plants')}
          <input
            className={ui.input}
            type="number"
            inputMode="numeric"
            min={1}
            value={count}
            onChange={event => setCount(Math.max(1, Math.round(Number(event.target.value)) || 1))}
          />
        </label>
      </div>
      {since === 'date' ? (
        <label className={styles.field}>
          {t('grow.new.startedOn')}
          <input
            className={ui.input}
            type="date"
            max={dayOf(serverNow().toJSDate(), zone)}
            value={dayOf(date, zone)}
            onChange={event => event.target.value && setDate(momentOn(event.target.value, date, zone))}
          />
        </label>
      ) : null}
      {fixed === null && places.length > 0 ? (
        <label className={styles.field}>
          {t('grow.new.where')}
          <select className={ui.input} value={spaceId ?? NOWHERE} onChange={event => setWhere(event.target.value)}>
            {places.map(one => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
            <option value={NOWHERE}>{t('grow.noFixedPlace')}</option>
          </select>
        </label>
      ) : null}
      <div className={`${ui.segments} ${ui.segmentsFill}`} role="group" aria-label={t('home.entryKind.phase')}>
        {START_STAGES.map(one => (
          <button key={one} type="button" className={ui.segment} aria-pressed={stage === one} onClick={() => setStage(one)}>
            {t(`home.stage.${one}`)}
          </button>
        ))}
      </div>
      {germinates ? (
        <GerminationChoices
          ref={choices}
          value={{ ...choicesOf(controller), ...germination }}
          onChange={change => setGermination({ ...germination, ...change })}
          humidifier={humidifier}
          humidity={GERMINATION_HUMIDITY}
          disabled={busy}
        />
      ) : null}
      {sheet ? null : button}
    </form>
  );

  return sheet ? (
    <Sheet {...sheet} actions={button}>
      <div className={ui.sheetBody}>{questions}</div>
    </Sheet>
  ) : (
    questions
  );
}

/**
 * The form as a sheet over the page it was asked on. A grow started in a
 * place is drawn by Grow, which is where the sheet lets go to; one standing in
 * none has only its own page.
 */
export function StartGrowSheet({
  spaceId = null,
  name = null,
  replace = false,
  onClose,
}: {
  spaceId?: string | null;
  /** What the place is called, where the sheet was opened for one. */
  name?: string | null;
  /** True where the sheet is the address itself, so the grow's page takes its place rather than stacking on it. */
  replace?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <WhatGrows
      spaceId={spaceId}
      sheet={{ title: spaceId && name ? t('start.grow.title', { name }) : t('grow.new.title'), noEntry: replace, onClose }}
      onStarted={(growId, where) => {
        if (!replace) onClose();
        void navigate(where ? `${GROW}?${new URLSearchParams({ space: where }).toString()}` : `/grows/${growId}`, { replace });
      }}
    />
  );
}
