import { Minus, Plus, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { Camera, Device, GrowListItem, GrowthStage, Space, SpaceKind } from '@fg2/shared-types/v1';
import { useCameras } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useCreateGrow, useGrows, useStartingPhase } from '@/api/grows';
import { serverNow } from '@/api/clock';
import { useApplyPreset } from '@/api/lifecycle';
import { growSchemeOf, useScheme, useSchemes, type SchemeSummary } from '@/api/schemes';
import { useSpaces } from '@/api/spaces';
import { Sheet } from '@/log/Sheet';
import { instantOf } from '@/ui/age';
import { LoadFailed, Refused, Waiting } from '@/ui/PageState';
import { writesClimate } from '@/ui/presets';
import { Block, Choice, Choices, WhenField } from '@/ui/SheetParts';
import { enough, useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { DAY_IN_YEAR } from '@/ui/zone';
import { useCreateSpace } from './create-space';
import { dayNumber, growBody, growIn, presetFor, START_STAGES, suggestedName, tells, type Draft, type PlantRow } from './new-grow';
import styles from './NewGrow.module.css';

/** The kinds of place a grow can be started in. A room holds other places rather than plants, so it is not one of them. */
const SPACE_KINDS: SpaceKind[] = ['tent', 'fridge', 'balcony', 'other'];

interface NewGrowSheetProps {
  /** The place the sheet was opened from, if it was opened from one. */
  spaceId?: string | null;
  /**
   * The stage a tent was just put on, when a preset applied to it is what led
   * here - which also says that its climate has just been written, and is not
   * to be written again over the refinement that application may have carried.
   */
  stage?: GrowthStage | null;
  /** True where the sheet is the address itself, so that the grow's page takes its place rather than stacking on it. */
  replace?: boolean;
  onClose: () => void;
}

/**
 * Starting a grow: the one sheet that stands between a claimed device and a
 * diary, and the first door of an empty home.
 *
 * It asks six things and decides the rest, because every question here has an
 * answer that is right far more often than it is wrong: a count is enough
 * without names, today is when a grow begins, and the preset an autoflower
 * needs follows from its being one rather than from anybody choosing it. What
 * the choices come to is printed under them and changes as they are made, so
 * the tap that starts the grow is never the first time the tent it steers is
 * mentioned.
 *
 * It is two writes and sometimes a third, and they are reported as such. A grow
 * exists from the moment it is sown; its day counter runs from its first phase;
 * and the climate of the place it stands in is written where the phase itself
 * would not write it. Each step is skipped once it has succeeded, so a refusal
 * is retried rather than repeated - a second tap after a refused phase does not
 * make a second grow.
 */
export function NewGrowSheet({ spaceId = null, stage = null, replace = false, onClose }: NewGrowSheetProps) {
  const { t } = useTranslation();
  const spaces = useSpaces();
  const grows = useGrows();
  const devices = useDevices();
  const cameras = useCameras();
  const schemes = useSchemes();

  // The schemes are waited for with the rest, because the draft opens on the
  // first of them and a draft built before they arrive would keep "None / my
  // own" for the whole session - which is the very first grow of a cold cache.
  if (spaces.isPending || grows.isPending || schemes.isPending) {
    return (
      <Sheet title={t('grow.new.title')} onClose={onClose}>
        <Waiting />
      </Sheet>
    );
  }

  if (!spaces.data || !grows.data) {
    return (
      <Sheet title={t('grow.new.title')} onClose={onClose}>
        <LoadFailed
          retry={() => {
            void spaces.refetch();
            void grows.refetch();
          }}
        />
      </Sheet>
    );
  }

  return (
    <Form
      spaces={spaces.data.items}
      grows={grows.data.items}
      devices={devices.data?.items ?? null}
      devicesFailed={devices.isError && devices.data === undefined}
      retryDevices={() => void devices.refetch()}
      cameras={cameras.data?.items ?? []}
      schemes={schemes.data ?? []}
      schemesFailed={schemes.isError}
      spaceId={spaceId}
      stage={stage}
      replace={replace}
      onClose={onClose}
    />
  );
}

interface FormProps extends NewGrowSheetProps {
  spaces: Space[];
  grows: GrowListItem[];
  /** Null where the devices could not be read: a failed read is not an empty room, and the sheet says which it is. */
  devices: Device[] | null;
  devicesFailed: boolean;
  retryDevices: () => void;
  cameras: Camera[];
  schemes: SchemeSummary[];
  schemesFailed: boolean;
}

/** What the reason under a dead primary is called, so the button can point at it. */
const REASON_ID = 'new-grow-reason';

/**
 * The questions, once there is enough to draw them with. They are split from
 * the reads above so that the draft opens on what the account really has - the
 * place the plants most likely go, and the name after the last run - rather
 * than on a guess corrected a moment later by an answer arriving.
 */
function Form({
  spaces,
  grows,
  devices,
  devicesFailed,
  retryDevices,
  cameras,
  schemes,
  schemesFailed,
  spaceId = null,
  stage = null,
  replace = false,
  onClose,
}: FormProps) {
  const { t } = useTranslation();
  const now = useNow();
  const navigate = useNavigate();
  const mayManage = useMayManage();

  // Starting a grow in a place is managing it, so the places on offer are the
  // ones this account manages; "no fixed place" needs none and stays.
  const places = spaces.filter(space => space.archivedAt === null && space.kind !== 'room' && enough(space.youMay, 'manage'));
  const [draft, setDraft] = useState<Draft>(() => ({
    name: '',
    plants: [{ key: '1', strain: '', count: 1 }],
    type: 'photoperiod',
    // A place that was asked for wins, but only if it still exists: this sheet
    // is an address, and an address outlives the tent it named. Otherwise the
    // first free place, because defaulting into somebody's flowering tent puts
    // a second grow in it and pauses the plan steering the first.
    spaceId: places.some(one => one.id === spaceId) ? spaceId : (places.find(one => growIn(grows, one.id) === null)?.id ?? null),
    stage: stage ?? 'germination',
    startedAt: serverNow().toJSDate(),
    schemeId: schemes[0]?.id ?? null,
  }));
  /** Open while a place is being invented, and closed again by the place existing. */
  const [naming, setNaming] = useState(false);
  const [backdating, setBackdating] = useState(false);
  /** What already stands, so that a retry after a refusal carries on rather than starting again. */
  const [made, setMade] = useState<{ growId: string | null; phaseDone: boolean; climateDone: boolean }>({
    growId: null,
    phaseDone: false,
    climateDone: false,
  });

  const createGrow = useCreateGrow();
  const startingPhase = useStartingPhase();
  const applyPreset = useApplyPreset(draft.spaceId ?? '');
  const scheme = useScheme(draft.schemeId);

  const change = (over: Partial<Draft>) => setDraft(current => ({ ...current, ...over }));
  const place = places.find(one => one.id === draft.spaceId) ?? null;
  const standing = place === null || devices === null ? null : devices.filter(device => device.spaceId === place.id);
  const already = place === null ? null : growIn(grows, place.id);
  const suggestion = suggestedName(grows, draft.spaceId, t('grow.new.firstName'));
  const preset = presetFor(draft.type, draft.stage);
  const day = dayNumber(draft.startedAt, now);
  // The phase writes the tent's climate only where it carries a preset, so the
  // stage that carries none is applied to the place on its own - unless the
  // sheet that opened this one has just written that very stage there. A place
  // whose hardware could not be read is not written to at all: guessing there
  // is a controller is the one mistake that cannot be taken back.
  const alsoClimate =
    place !== null &&
    preset === null &&
    writesClimate(draft.stage) &&
    standing !== null &&
    standing.length > 0 &&
    !(stage !== null && draft.stage === stage);
  const busy = createGrow.isPending || startingPhase.isPending || applyPreset.isPending;
  const refused = createGrow.error ?? startingPhase.error ?? applyPreset.error;
  const ready = draft.schemeId === null || scheme.data !== undefined;
  // Why the primary cannot act, said rather than left to be discovered: a place
  // that is being invented is not a place yet, and a scheme that has not been
  // read is not a grid to feed from.
  const blocked = naming ? 'grow.new.placeFirst' : ready ? null : 'grow.new.notReady';

  const told = tells(
    draft,
    place === null
      ? null
      : {
          name: place.name,
          steered: standing === null ? null : standing.length > 0,
          standing: already?.name ?? null,
          writesClimate: alsoClimate,
        },
    t(`home.stage.${draft.stage}`),
  );
  const warning = told.find(one => one.warns) ?? null;

  const start = async () => {
    const body = growBody(
      draft,
      draft.name.trim() || suggestion,
      scheme.data ? growSchemeOf(scheme.data, { type: draft.type }) : null,
      t('grow.new.unnamedStrain'),
    );
    try {
      let growId = made.growId;
      if (growId === null) {
        growId = (await createGrow.mutateAsync(body)).id;
        setMade(state => ({ ...state, growId }));
      }
      if (!made.phaseDone) {
        await startingPhase.mutateAsync({
          growId,
          body: { stage: draft.stage, preset, startedAt: instantOf(DateTime.fromJSDate(draft.startedAt)) },
        });
        setMade(state => ({ ...state, phaseDone: true }));
      }
      if (alsoClimate && !made.climateDone) {
        await applyPreset.mutateAsync({ stage: draft.stage, preset: null });
        setMade(state => ({ ...state, climateDone: true }));
      }
      await navigate(`/grows/${growId}`, { replace });
    } catch {
      // Each of the three keeps its own refusal, and what already stands is said
      // under them; the sheet is the place to try the rest again.
    }
  };

  return (
    <Sheet
      title={t('grow.new.title')}
      onClose={onClose}
      actions={
        mayManage ? (
          <>
            {refused && made.growId !== null ? (
              <p className={ui.note} role="status">
                {t(made.phaseDone ? 'grow.new.climateLeft' : 'grow.new.growStands')}
              </p>
            ) : null}
            {/* The sentences under the chips scroll away on a phone, and what
                the tap would disturb is the one of them that must not. */}
            {warning ? <p className={ui.note}>{t(warning.key, warning.values)}</p> : null}
            {blocked ? (
              <p className={ui.note} id={REASON_ID}>
                {t(blocked)}
              </p>
            ) : null}
            <Refused error={refused} />
            <button
              type="button"
              className={`${ui.button} ${ui.primary} ${styles.submit}`}
              disabled={blocked !== null || busy}
              aria-describedby={blocked ? REASON_ID : undefined}
              onClick={() => void start()}
            >
              {busy ? t('grow.new.starting') : t('grow.new.submit', { day })}
            </button>
          </>
        ) : (
          <p className={ui.note}>{t('grow.new.readOnly')}</p>
        )
      }
    >
      <div className={styles.body}>
        <label className={`${ui.card} ${styles.name}`}>
          <input
            className={styles.nameInput}
            value={draft.name}
            placeholder={t('grow.new.name')}
            aria-label={t('grow.new.name')}
            autoComplete="off"
            onChange={event => change({ name: event.target.value })}
          />
          <button type="button" className={`mono ${styles.suggestion}`} onClick={() => change({ name: suggestion })}>
            {suggestion}
          </button>
        </label>

        <Block label={t('grow.new.plants')} aside={t('grow.new.plantsAside')}>
          {draft.plants.map((row, index) => (
            <PlantsRow
              key={row.key}
              row={row}
              removable={draft.plants.length > 1}
              onChange={next => change({ plants: draft.plants.map((one, at) => (at === index ? next : one)) })}
              onRemove={() => change({ plants: draft.plants.filter((_, at) => at !== index) })}
            />
          ))}
          <button
            type="button"
            className={`${ui.cardDashed} ${ui.addRow}`}
            onClick={() => change({ plants: [...draft.plants, { key: nextKey(draft.plants), strain: '', count: 1 }] })}
          >
            {t('grow.new.addStrain')}
          </button>
        </Block>

        <Block label={t('grow.new.type')} aside={t('grow.new.typeAside')}>
          <div className={`${ui.segments} ${ui.segmentsFill}`} role="group" aria-label={t('grow.new.type')}>
            <button type="button" className={ui.segment} aria-pressed={draft.type === 'photoperiod'} onClick={() => change({ type: 'photoperiod' })}>
              {t('grow.new.photoperiod')}
            </button>
            <button type="button" className={ui.segment} aria-pressed={draft.type === 'autoflower'} onClick={() => change({ type: 'autoflower' })}>
              {t('grow.new.autoflower')}
            </button>
          </div>
        </Block>

        <Block label={t('grow.new.where')} aside={t('grow.new.whereAside')}>
          <Choices label={t('grow.new.where')}>
            {places.map(one => (
              <Choice
                key={one.id}
                chosen={!naming && draft.spaceId === one.id}
                onChoose={() => {
                  setNaming(false);
                  change({ spaceId: one.id });
                }}
              >
                {standsIn(one, devices, cameras, t)}
              </Choice>
            ))}
            {/* Letting go of the held place as well as opening the form, so
                that what is printed under the chips is the answer on screen
                rather than the tent that was chosen before. */}
            <Choice
              chosen={naming}
              onChoose={() => {
                setNaming(true);
                change({ spaceId: null });
              }}
            >
              {t('grow.new.newSpace')}
            </Choice>
            <Choice
              chosen={!naming && draft.spaceId === null}
              onChoose={() => {
                setNaming(false);
                change({ spaceId: null });
              }}
            >
              {t('grow.noFixedPlace')}
            </Choice>
          </Choices>
          {devicesFailed ? (
            <p className={ui.note}>
              {t('grow.new.devicesUnread')}{' '}
              <button type="button" className={styles.retry} onClick={retryDevices}>
                {t('home.retry')}
              </button>
            </p>
          ) : null}
          {naming ? (
            <NewSpace
              onMade={space => {
                setNaming(false);
                change({ spaceId: space.id });
              }}
            />
          ) : null}
        </Block>

        <Block label={t('grow.new.startingAt')} aside={t('grow.new.startingAside')}>
          <Choices label={t('grow.new.startingAt')}>
            {START_STAGES.map(one => (
              <Choice key={one} chosen={draft.stage === one} onChoose={() => change({ stage: one })}>
                {t(`home.stage.${one}`)}
                {draft.stage === one ? ` · ${backdating ? DateTime.fromJSDate(draft.startedAt).toFormat(DAY_IN_YEAR) : t('grow.new.today')}` : ''}
              </Choice>
            ))}
            <Choice
              chosen={backdating}
              onChoose={() => {
                setBackdating(!backdating);
                if (backdating) change({ startedAt: serverNow().toJSDate() });
              }}
            >
              {t('grow.new.earlier')}
            </Choice>
          </Choices>
          {backdating ? <WhenField label={t('grow.new.startedOn')} at={draft.startedAt} onChange={at => change({ startedAt: at })} /> : null}
        </Block>

        <Block label={t('grow.new.feeding')} aside={t('grow.new.feedingAside')}>
          <Choices label={t('grow.new.feeding')}>
            {schemes.map(one => (
              <Choice key={one.id} chosen={draft.schemeId === one.id} onChoose={() => change({ schemeId: one.id })}>
                {one.name}
              </Choice>
            ))}
            <Choice chosen={draft.schemeId === null} onChoose={() => change({ schemeId: null })}>
              {t('grow.new.ownScheme')}
            </Choice>
          </Choices>
          {/* A build with no schemes folder and a read that failed are not the
              same thing, and only one of them is worth trying again. */}
          {schemesFailed ? <p className={ui.note}>{t('grow.new.schemesUnread')}</p> : null}
          {!schemesFailed && schemes.length === 0 ? <p className={ui.note}>{t('grow.new.noSchemes')}</p> : null}
          {scheme.isError ? (
            <p className={ui.problem} role="alert">
              {t('grow.new.schemeUnreadable')}
            </p>
          ) : null}
        </Block>

        <ul className={styles.tells}>
          {told.map(one => (
            <li key={one.key}>{t(one.key, one.values)}</li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

/** A row's key, which only has to differ from the others: one more than the largest there is. */
const nextKey = (rows: PlantRow[]): string => String(Math.max(0, ...rows.map(row => Number(row.key) || 0)) + 1);

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "Tent 1 · Controller + Cam": the place, and what stands in it, because that is
 * what a grower knows it by. Where the devices could not be read the name goes
 * on its own, since half the hardware is a claim about the other half.
 */
const standsIn = (space: Space, devices: Device[] | null, cameras: Camera[], t: Translate): string => {
  if (devices === null) return space.name;

  const kinds = [...new Set(devices.filter(device => device.spaceId === space.id).map(device => device.type))];
  const here = kinds.map(kind => t(`devices.type.${kind}`, { defaultValue: kind }));
  if (cameras.some(camera => camera.spaceId === space.id && camera.removedAt === null)) here.push(t('grow.new.cam'));

  return here.length === 0 ? space.name : `${space.name} · ${here.join(' + ')}`;
};

/** One strain and how many of it. The count is stepped rather than typed: it is a handful of plants, not a figure. */
function PlantsRow({
  row,
  removable,
  onChange,
  onRemove,
}: {
  row: PlantRow;
  removable: boolean;
  onChange: (row: PlantRow) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className={`${ui.card} ${styles.plant}`}>
      <input
        className={styles.strain}
        value={row.strain}
        placeholder={t('grow.new.strain')}
        aria-label={t('grow.new.strain')}
        autoComplete="off"
        onChange={event => onChange({ ...row, strain: event.target.value })}
      />
      <span className={`mono ${styles.count}`}>× {row.count}</span>
      <button
        type="button"
        className={`${ui.chip} ${styles.step}`}
        aria-label={t('grow.new.fewer')}
        disabled={row.count <= 1}
        onClick={() => onChange({ ...row, count: row.count - 1 })}
      >
        <Minus size={14} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className={`${ui.chip} ${styles.step}`}
        aria-label={t('grow.new.more')}
        onClick={() => onChange({ ...row, count: row.count + 1 })}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden />
      </button>
      {removable ? (
        <button type="button" className={styles.remove} aria-label={t('grow.new.removeStrain')} onClick={onRemove}>
          <X size={14} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * A place invented here. It is written before the grow is, because a chip
 * standing for a place that does not exist yet would be the one answer this
 * sheet could not keep - and a grower who then closes the sheet is left with a
 * tent to claim a controller into, which is not a wrong thing to be left with.
 */
function NewSpace({ onMade }: { onMade: (space: Space) => void }) {
  const { t } = useTranslation();
  const create = useCreateSpace();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SpaceKind>('tent');

  return (
    <div className={styles.newSpace}>
      <input
        className={ui.input}
        value={name}
        placeholder={t('grow.new.spaceName')}
        aria-label={t('grow.new.spaceName')}
        autoComplete="off"
        onChange={event => setName(event.target.value)}
      />
      <Choices label={t('grow.new.spaceKind')}>
        {SPACE_KINDS.map(one => (
          <Choice key={one} chosen={kind === one} onChoose={() => setKind(one)}>
            {t(`grow.new.kind.${one}`)}
          </Choice>
        ))}
      </Choices>
      <Refused error={create.error} />
      <button
        type="button"
        className={ui.button}
        disabled={create.isPending || name.trim() === ''}
        onClick={() => create.mutate({ kind, name: name.trim() }, { onSuccess: onMade })}
      >
        {create.isPending ? t('grow.new.makingSpace') : t('grow.new.makeSpace')}
      </button>
    </div>
  );
}
