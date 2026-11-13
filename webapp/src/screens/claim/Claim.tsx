import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { placePath, placesOf } from '@/app/places';
import type { Device, DeviceClaimResult, Space } from '@fg2/shared-types/v1';
import { OWN_CLIMATE_TYPES, SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useMe } from '@/api/account';
import { useClaimedDevice, useEndInvented } from '@/api/claims';
import { useDevices, useSocketTables, useUpdateDevice } from '@/api/devices';
import { useSpaceGrows } from '@/api/grows';
import { useApplyPreset } from '@/api/lifecycle';
import { ApiError } from '@/api/problem';
import { useSession } from '@/api/session';
import { useCreateSpace, useSpaces } from '@/api/spaces';
import { useLog } from '@/log/log-context';
import { NotifyStep } from '@/screens/notifications/NotifyNotice';
import type { HelpTopic } from '@/ui/explain';
import { deviceName, placeKindOf } from '@/ui/naming';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { AirStep } from './AirStep';
import { ClaimedFacts, ClaimedTitle, CodeStep } from './CodeStep';
import { DoingStep } from './DoingStep';
import { FlowHead } from './FlowHead';
import { GrowStep } from './GrowStep';
import { HardwareStep } from './HardwareStep';
import { Step } from './Step';
import {
  ASKED,
  climateIn,
  doingSummary,
  hangWords,
  hardwareSummary,
  joinOrder,
  MEASURE,
  newPlaceName,
  NOTHING_DOING,
  notifySummary,
  placeSummary,
  planOf,
  presetBodyOf,
  type Asked,
  type Doing,
} from './steps';
import styles from './Claim.module.css';

/** What a read holds, asked for where it has not answered yet; `must` is for an answer nothing may be written without, and throws what the read failed with. */
const known = async <T,>(
  read: { data: T | undefined; refetch: (how: { throwOnError: boolean }) => Promise<{ data: T | undefined }> },
  must = false,
): Promise<T | undefined> => read.data ?? (await read.refetch({ throwOnError: must })).data;

/** Where a question stands: the device, what its claim said it would ask, which of that is open, and the place the flow made. */
const addressOf = (device: string, plan: readonly Asked[], at = '', made: string | null = null): Record<string, string> =>
  made ? { device, ask: plan.join('.'), at, made } : { device, ask: plan.join('.'), at };

/**
 * Adding a device: the code that proves the hardware is yours, then the things
 * that have to be true before it is of any use, in the order they can be
 * answered, and last what grows here, where the diary begins (`GrowStep`) and
 * the place's climate is set with the phase; an account without the diary is
 * asked what the place is doing instead (`DoingStep`).
 *
 * It is a screen of its own rather than a sheet because somebody stands in a
 * room with hardware in their hands, and every answer is written the moment it
 * is given: there is no Save at the end and nothing is lost by leaving. It is
 * reached from Steuerung and from a place's ⋯ on Start, and stands outside the
 * app's bar (`BARE`, `app/shell/AppShell.tsx`): a string of questions has one way on and one out.
 *
 * What is asked depends on the device, the account and the place, so the head
 * counts no steps before it is settled where the device hangs, and then the
 * ones decided (`planOf`): an answer may end the flow early, none adds to it.
 *
 * The device, what will be asked and which question is open live in the
 * address, because the phone in that room locks, drops the tab and follows
 * links out of the flow; and every question is an entry of the history, so
 * Back is one question back. A claim spends the code on the display, so the
 * entry that asked for it is given to the device alone (`?device=`): the flow
 * goes on from there, and coming back to it leaves for the place it hangs in.
 */
export function Claim() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useNow();
  const mayManage = useMayManage();
  const [params, setParams] = useSearchParams();
  const { user } = useSession();
  const { tell } = useLog();

  const deviceId = params.get('device');
  const asked = params.get('ask');
  const plan = asked === null ? null : ASKED.filter(step => asked.split('.').includes(step));
  // The place this flow made, which ends when the device turns out to hang in one the account already had. Kept
  // here as well as in the address: an entry of the history that is come back to says what was true when it was written.
  const [made, setMade] = useState(() => params.get('made'));
  const [doing, setDoing] = useState<Doing>(NOTHING_DOING);
  const [startingGrow, setStartingGrow] = useState(false);
  // The furthest step opened: going back to correct an answer does not turn the steps after it back into questions.
  const [furthest, setFurthest] = useState(-1);
  // The first question's address, handed from the claim to the entry it has just given to the device.
  const entering = useRef<Record<string, string> | null>(null);
  // How many entries of the history this one stands over the device's own, and where a leave on its way back there goes.
  const steps = (useLocation().state as { steps?: number } | null)?.steps ?? 0;
  const out = useRef<{ to: string; from: number } | null>(null);

  const device = useClaimedDevice(deviceId);
  const spaces = useSpaces();
  const devices = useDevices();
  const makePlace = useCreateSpace();
  const move = useUpdateDevice(deviceId ?? '');
  const end = useEndInvented();
  const me = useMe(false, mayManage);

  const claimed = device.data ?? null;
  // Asked of a device that was read: one this account cannot read has no sockets to refuse as well.
  const tables = useSocketTables(claimed ? [claimed.id] : []);
  const sockets = claimed ? tables.tables.get(claimed.id) : undefined;
  const spaceId = claimed?.spaceId ?? null;
  const places = spaces.data?.items ?? [];
  const every = devices.data?.items ?? [];
  const space = places.find(one => one.id === spaceId) ?? null;
  const apply = useApplyPreset(spaceId ?? '');
  // What the place is on according to the server: a choice made here does not survive the reload the address does.
  const growsHere = useSpaceGrows(spaceId);
  const onServer =
    spaceId === null || !growsHere.isPending ? (growsHere.data?.items.find(grow => grow.endedAt === null)?.summary.stage ?? null) : undefined;

  // The account's own places, which a device may hang in: what a guest adds is theirs, and stands in a place of theirs.
  const own = (items: readonly Space[]) => placesOf(items, user?.id);
  // The place the flow was opened from ("Gerät hierher holen"): the claim puts the device there and asks nothing.
  const opened = own(places).find(one => one.id === params.get('space')) ?? null;

  // A device in the address that this account cannot read is said in a sentence over the field for a code; a server
  // that could not be reached is a different thing and keeps its retry.
  const lost = device.error instanceof ApiError && !device.data;
  const ready = claimed !== null && !spaces.isPending && !devices.isPending;

  // What of the plan is still a question. A fan, a socket or a lamp beside a controller hangs in its climate and is
  // asked nothing but where; a second controller there is not asked for a climate, which would be written to the
  // first as well; and what grows is not asked where something does - except while that very answer is on its way.
  const ownClimate = claimed !== null && OWN_CLIMATE_TYPES.includes(claimed.type);
  const beside = claimed !== null && climateIn(every, spaceId, claimed.id);
  const growing = growsHere.data?.items.some(grow => grow.endedAt === null) === true;
  const asks = (step: Asked) =>
    step === 'place' || ((ownClimate ? !beside || step !== 'doing' : !beside) && (step !== 'grow' || startingGrow || !growing));
  const open = (ready && plan?.slice(Math.max(0, plan.indexOf(params.get('at') as Asked))).find(asks)) || null;
  const here = plan && open ? plan.indexOf(open) : -1;
  if (here > furthest) setFurthest(here);

  // Before the first question - where the claim has just put the address, or Back has led - and past the last one:
  // the claim goes on to its first question from here, anything else leaves for the place. A flow that is left steps
  // back onto this entry first, so the place takes it and Back from there finds no question, but where the flow came from.
  const outside = deviceId !== null && !lost && (plan === null || (ready && open === null));
  useEffect(() => {
    const first = outside ? entering.current : null;
    const leaving = out.current;
    const to = leaving?.to ?? (outside ? spaceId : null);
    if (outside) entering.current = null;
    if (first) setParams(first, { state: { steps: 1 } });
    else if (leaving && steps > 0) {
      // A step back that came down short of the device's entry - a sheet left one of its own on the way - goes on from there.
      if (leaving.from === steps) return;
      leaving.from = steps;
      void navigate(-steps);
    } else if (to) void navigate(placePath(to), { replace: true });
  }, [outside, steps, spaceId, setParams, navigate]);

  // The keyboard and the screen reader go to the question that opens: the form that was focused is off the page.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  if (!mayManage) return <OnlyLooking />;

  const leaveTo = (to: string | null) => {
    if (to && steps > 0) {
      out.current = { to, from: steps };
      void navigate(-steps);
    } else void navigate(to ? placePath(to) : '/', { replace: true });
  };
  const leave = () => leaveTo(spaceId);
  const go = (step: Asked, madeId = made, asking = plan!) => setParams(addressOf(deviceId!, asking, step, madeId), { state: { steps: steps + 1 } });

  // A device that joined a climate is done: it is said where it hangs now, on the Start of that place.
  const joined = (which: Device, where: Space) => {
    tell({ label: hangWords(t, 'joined', which.type, { device: deviceName(which, t), place: where.name }), undo: null });
    leaveTo(where.id);
  };
  // The cross after the code was taken says the same: the device hangs somewhere, whatever was left unanswered.
  const close = () => (claimed && space ? joined(claimed, space) : leave());

  // Where the claim puts the device, in its one write: the place the flow was opened from, else - for a fan, a socket
  // or a lamp, which the server tells apart - the first answer the question of where it hangs will give; and what a
  // place it makes is called, in the reader's language, which the server has none of. A code is not spent on places
  // that could not be read: the claim would stand the device somewhere by guesswork.
  const whereTo = async () => {
    const join = joinOrder(own((await known(spaces, true))?.items ?? []), (await known(devices, true))?.items ?? [])[0];
    const spaceNames = { tent: t('claim.place.newName.tent'), fridge: t('claim.place.newName.fridge') };
    return opened ? { spaceId: opened.id } : { spaceNames, ...(join ? { joinSpaceId: join.id } : {}) };
  };

  // What a claim sets in motion before anything is asked: the place it made - for a controller or a fridge module,
  // or in an account that had none, called by the words sent with it - is kept in mind, and what will be asked is decided.
  const entered = async ({ device: got, spaceCreated }: DeviceClaimResult) => {
    const madeId = spaceCreated ? got.spaceId : null;
    const others = own((await known(spaces))?.items ?? []).filter(one => one.id !== madeId);
    const beside = climateIn((await known(devices))?.items ?? [], got.spaceId, got.id);
    setMade(madeId);

    if (opened && beside && !OWN_CLIMATE_TYPES.includes(got.type)) return joined(got, opened);
    const asking = planOf(got, !opened && others.length > 0, beside, await known(me));
    entering.current = addressOf(got.id, asking, asking[0], madeId);
    setParams({ device: got.id }, { replace: true });
  };

  // Before the claim; and while the device is read, with the way out where the read failed. What grows is a
  // question about a place by name, and none where something grows already: it waits for both.
  const before = deviceId === null || lost;
  if (before || !claimed || !plan || !open || (open === 'grow' && (!space || growsHere.isPending))) {
    return (
      <section className={`${ui.stack4} ${ui.page} ${styles.screen}`}>
        {before || (!claimed && device.isError) ? <FlowHead type={null} onClose={close} /> : null}
        {before ? (
          <Step number={1} state="open" title={t('claim.code.title')} help="claimCode" text={lost ? t('claim.code.notYours') : null}>
            <CodeStep initialCode={params.get('code') ?? ''} into={opened} where={whereTo} onClaimed={entered} />
          </Step>
        ) : !claimed && device.isError ? (
          <LoadFailed retry={() => void device.refetch()} />
        ) : (
          <Waiting lines={3} />
        )}
      </section>
    );
  }

  const step = here + 2;
  const of = plan.length + 1;
  const after = plan.slice(here + 1).find(asks) ?? null;

  // The answer to where it hangs, written; a refusal is said under the answers, and the same tap tries again. A
  // place that exists takes the device and ends the one this flow made. A new one is made only where the device
  // stands in none of the flow's, and ends again if the device does not get in - or is kept for the next answer.
  const hang = async (to: Space | null) => {
    let madeId = made;
    if (to === null && (made === null || spaceId !== made)) {
      const kind = placeKindOf(claimed.type, 'tent');
      const into = made ?? (await makePlace.mutateAsync({ kind, name: newPlaceName(claimed.type, own(places), t) })).id;
      setMade((madeId = into));
      await move.mutateAsync({ spaceId: into }).catch(async (refused: unknown) => {
        const ended = end.mutateAsync(into).then(() => setMade(null));
        await ended.catch(() => undefined);
        throw refused;
      });
    } else if (to !== null) {
      if (spaceId !== to.id) await move.mutateAsync({ spaceId: to.id });
      if (made) await end.mutateAsync(made);
      setMade((madeId = null));
    }

    // Where it hangs decides whether a climate is asked for - never where what grows is asked, which sets it - so the
    // steps are counted from this answer on.
    const beside = to !== null && climateIn(every, to.id, claimed.id);
    const rest = ASKED.filter(one => (one === 'doing' ? ownClimate && !beside && !plan.includes('grow') : plan.includes(one)));
    if (to && beside && !ownClimate) joined(claimed, to);
    else if (rest[1]) go(rest[1], madeId, rest);
    else leaveTo(to?.id ?? madeId);
  };

  if (open === 'place') {
    return (
      <AirStep
        device={claimed}
        places={joinOrder(own(places), every, claimed.id).filter(one => one.id !== made)}
        every={every}
        headingRef={heading}
        hang={hang}
        onBack={() => void navigate(-1)}
        onLeave={close}
      />
    );
  }

  if (open === 'grow' && space) {
    return (
      <GrowStep
        device={claimed}
        space={space}
        stage={doing.applied?.stage ?? onServer ?? null}
        step={step}
        of={of}
        headingRef={heading}
        onStarting={() => setStartingGrow(true)}
        onLeave={leave}
        onClose={close}
      />
    );
  }

  // Sockets and a cam are paired at a fridge module or a controller, a cam alone at a smart socket or an AIR fan.
  const camOnly = !SOCKET_HOST_TYPES.includes(claimed.type);
  const keyOf = (name: Asked): string => (name === 'hardware' && camOnly ? 'camOnly' : name);
  // What each step is called, what it settled and what it opens to. Where it hangs and what grows are pages of
  // their own and are named all the same: the head counts them.
  const doingStep = <DoingStep spaceId={spaceId} doing={doing} onDoing={setDoing} apply={apply} />;
  const rows: Record<Asked, { title: string; settled?: string | null; help?: HelpTopic; body?: ReactNode }> = {
    place: { title: hangWords(t, 'done', claimed.type), settled: placeSummary(space, t) },
    doing: { title: t('claim.doing.title'), settled: doingSummary(doing, onServer, t), help: 'climatePreset', body: doingStep },
    hardware: {
      title: t(`claim.${keyOf('hardware')}.title`),
      settled: hardwareSummary(claimed, sockets, t, camOnly),
      help: camOnly ? 'claimLater' : 'socketAddress',
      body: <HardwareStep device={claimed} sockets={sockets} camOnly={camOnly} />,
    },
    // About every device, and asked all the same: the offline rule is armed from the claim on, and nobody would hear it.
    notify: { title: t('claim.notify.title'), settled: notifySummary(me.data, t), help: 'emailAlarms', body: <NotifyStep me={me.data} /> },
    grow: { title: t('start.grow.here') },
  };

  // A stage picked but not yet written: the bottom button is where every step is left, so it carries the choice into the write.
  const pending = open === 'doing' && doing.chosen !== null && doing.chosen !== MEASURE && doing.applied === null ? doing.chosen : null;
  const onward = () => {
    if (!pending || !spaceId) {
      if (after) go(after);
      else leave();
      return;
    }

    apply.mutate(presetBodyOf(pending, doing), {
      onSuccess: result => {
        setDoing({ ...doing, chosen: pending, applied: result });
        if (after) go(after);
      },
    });
  };

  return (
    <section className={`${ui.stack4} ${ui.page} ${styles.screen}`}>
      <FlowHead type={claimed.type} step={step} of={of} onClose={close} />

      {/* A step change announces nothing by itself: this says what has opened. */}
      <p className={ui.visuallyHidden} role="status">
        {t('claim.opened', { title: rows[open].title, step, of })}
      </p>

      {device.isError ? <RefreshFailed failedAt={device.dataUpdatedAt} now={now} /> : null}

      <Step number={1} state="done" title={<ClaimedTitle device={claimed} />} text={<ClaimedFacts device={claimed} sockets={sockets} now={now} />} />

      {plan.map((name, index) => {
        const state = name === open ? 'open' : index <= furthest ? 'done' : 'ahead';
        const { title, settled, help, body } = rows[name];

        return (
          <Step
            key={name}
            number={index + 2}
            state={state}
            title={title}
            help={help}
            text={state === 'done' && asks(name) ? settled : null}
            onOpen={asks(name) ? () => go(name) : undefined}
            headingRef={heading}
          >
            {body}
          </Step>
        );
      })}

      <footer className={styles.foot}>
        <button type="button" className={`${ui.button} ${ui.primary} ${styles.wide}`} disabled={apply.isPending} onClick={onward}>
          {after ? t('claim.next', { what: t(`claim.${keyOf(after)}.next`) }) : t('claim.finish')}
        </button>
      </footer>
    </section>
  );
}

/**
 * The demo may look at everything and change nothing, and a claim would bind
 * real hardware to an account everybody shares. The field is not drawn at all
 * rather than drawn and refused.
 */
function OnlyLooking() {
  const { t } = useTranslation();

  return (
    <section className={`${ui.stack4} ${ui.page} ${styles.screen}`}>
      <h1>{t('claim.title')}</h1>
      <p className={`${ui.cardDashed} ${styles.demoNote}`}>{t('claim.demo')}</p>
      <Link className={ui.button} to="/">
        {t('claim.backToStart')}
      </Link>
    </section>
  );
}
