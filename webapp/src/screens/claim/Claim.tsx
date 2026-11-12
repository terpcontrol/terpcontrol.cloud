import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { placePath } from '@/app/places';
import type { Device, DeviceClaimResult, Space } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useMe } from '@/api/account';
import { useClaimedDevice, useEndInvented, useNameNewPlace, usePlaceDevice } from '@/api/claims';
import { useDevices, useSocketTables } from '@/api/devices';
import { useSpaceGrows } from '@/api/grows';
import { useApplyPreset } from '@/api/lifecycle';
import { ApiError } from '@/api/problem';
import { useSession } from '@/api/session';
import { useCreateSpace, useSpaces } from '@/api/spaces';
import { useLog } from '@/log/log-context';
import { NotifyStep } from '@/screens/notifications/NotifyNotice';
import type { HelpTopic } from '@/ui/explain';
import { deviceName, typeName } from '@/ui/naming';
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
  MEASURE,
  newPlaceKind,
  newPlaceName,
  NOTHING_DOING,
  notifySummary,
  OWN_CLIMATE,
  placeSummary,
  planOf,
  presetBodyOf,
  type Asked,
  type Doing,
} from './steps';
import styles from './Claim.module.css';

/** What a read holds, asked for where it has not answered yet. */
const known = async <T,>(read: { data: T | undefined; refetch: () => Promise<{ data: T | undefined }> }): Promise<T | undefined> =>
  read.data ?? (await read.refetch()).data;

/** Where a question stands: the device, what its claim said it would ask, which of that is open, and the place the flow made. */
const addressOf = (device: string, plan: readonly Asked[], at = '', made: string | null = null): Record<string, string> =>
  made ? { device, ask: plan.join('.'), at, made } : { device, ask: plan.join('.'), at };

/**
 * Adding a device: the code that proves the hardware is yours, then the things
 * that have to be true before it is of any use, in the order they can be
 * answered, and last what grows here, where the diary begins (`GrowStep`).
 *
 * It is a screen of its own rather than a sheet because it is the one stretch
 * of the app where somebody stands in a room with hardware in their hands, and
 * because every answer is written the moment it is given: there is no Save at
 * the end and nothing is lost by leaving - the rest are the ordinary screens,
 * reached from Steuerung, from a device's page and from Ich. It stands outside
 * the app's bar (`BARE`, `app/shell/AppShell.tsx`): a string of questions has one way on and one out.
 *
 * What is asked depends on the device and the account, so the head counts no
 * steps before the claim and afterwards the ones decided then (`planOf`): an
 * answer may end the flow early, none makes it longer.
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

  const device = useClaimedDevice(deviceId);
  const spaces = useSpaces();
  const devices = useDevices();
  const namePlace = useNameNewPlace();
  const makePlace = useCreateSpace();
  const move = usePlaceDevice();
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
  const own = (items: readonly Space[]) => items.filter(one => one.kind !== 'room' && one.archivedAt === null && one.ownerId === user?.id);
  // The place the flow was opened from ("Gerät hierher holen"): the claim puts the device there and asks nothing.
  const opened = own(places).find(one => one.id === params.get('space')) ?? null;

  // A device in the address that this account cannot read is said in a sentence over the field for a code; a server
  // that could not be reached is a different thing and keeps its retry.
  const lost = device.error instanceof ApiError && !device.data;
  const ready = claimed !== null && !spaces.isPending && !devices.isPending;

  // What of the plan is still a question. A fan, a socket or a lamp beside a controller hangs in its climate and is
  // asked nothing but where; a second controller there is not asked for a climate, which would be written to the
  // first as well; and what grows is not asked where something does - except while that very answer is on its way.
  const ownClimate = claimed !== null && OWN_CLIMATE.includes(claimed.type);
  const beside = claimed !== null && climateIn(every, spaceId, claimed.id);
  const growing = growsHere.data?.items.some(grow => grow.endedAt === null) === true;
  const asks = (step: Asked) =>
    step === 'place' || ((ownClimate ? !beside || step !== 'doing' : !beside) && (step !== 'grow' || startingGrow || !growing));
  const open = (ready && plan?.slice(Math.max(0, plan.indexOf(params.get('at') as Asked))).find(asks)) || null;
  const here = plan && open ? plan.indexOf(open) : -1;
  if (here > furthest) setFurthest(here);

  // Before the first question - where the claim has just put the address, or Back has led - and past the last one:
  // the claim goes on to its first question from here, anything else leaves for the place.
  const outside = deviceId !== null && !lost && (plan === null || (ready && open === null));
  useEffect(() => {
    if (!outside) return;
    const first = entering.current;
    entering.current = null;
    if (first) setParams(first);
    else if (spaceId) void navigate(placePath(spaceId), { replace: true });
  }, [outside, spaceId, setParams, navigate]);

  // The keyboard and the screen reader go to the question that opens: the form that was focused is off the page.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  if (!mayManage) return <OnlyLooking />;

  const leaveTo = (to: string | null) => void navigate(to ? placePath(to) : '/', { replace: true });
  const leave = () => leaveTo(spaceId);
  const go = (step: Asked, madeId = made) => setParams(addressOf(deviceId!, plan!, step, madeId));

  // A device that joined a climate is done: it is said where it hangs now, on the Start of that place.
  const joined = (which: Device, where: Space) => {
    tell({ label: hangWords(t, 'joined', which.type, { device: deviceName(which, t), place: where.name }), undo: null });
    leaveTo(where.id);
  };

  // What a claim sets in motion before anything is asked. A fan, a socket or a lamp in an account that has a place
  // is hung where the question's first answer says and the place its claim made is ended, so a flow left at that
  // question leaves no place that holds nothing; a place that stays is named. Then what will be asked is decided.
  const entered = async ({ device: got, spaceCreated }: DeviceClaimResult) => {
    const others = own((await known(spaces))?.items ?? []).filter(one => one.id !== got.spaceId);
    const asksPlace = spaceCreated && others.length > 0;
    let madeId = spaceCreated ? got.spaceId : null;
    if (asksPlace && madeId && !OWN_CLIMATE.includes(got.type)) {
      try {
        await move.mutateAsync({ deviceId: got.id, spaceId: others[0].id });
        await end.mutateAsync(madeId);
        madeId = null;
      } catch {
        // It stays where the refused write left it, and the question shows that answer.
      }
    }
    if (madeId) namePlace.mutate({ spaceId: madeId, name: newPlaceName(got.type, others, t) });
    setMade(madeId);

    if (opened && !OWN_CLIMATE.includes(got.type) && climateIn((await known(devices))?.items ?? [], opened.id, got.id)) return joined(got, opened);
    const asking = planOf(got, asksPlace, await known(me));
    entering.current = addressOf(got.id, asking, asking[0], madeId);
    setParams({ device: got.id }, { replace: true });
  };

  // Before the claim; and while the device is read, with the way out where the read failed. What grows is a
  // question about a place by name, and none where something grows already: it waits for both.
  const before = deviceId === null || lost;
  if (before || !claimed || !plan || !open || (open === 'grow' && (!space || growsHere.isPending))) {
    return (
      <section className={styles.screen}>
        {before || (!claimed && device.isError) ? <FlowHead device={null} titled onClose={leave} /> : null}
        {before ? (
          <Step number={1} state="open" title={t('claim.code.title')} help="claimCode" text={lost ? t('claim.code.notYours') : null}>
            <CodeStep initialCode={params.get('code') ?? ''} into={opened} onClaimed={entered} />
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

  // The answer to where it hangs, written. A place that exists takes the device and ends the place this flow made;
  // a new one is made only where the device does not stand in one this flow made, and is kept in mind before the
  // device is moved, so a move that was refused is tried again into the same place rather than into a second one.
  const hang = async (to: Space | null) => {
    let madeId = made;
    if (to === null && (made === null || spaceId !== made)) {
      madeId = made ?? (await makePlace.mutateAsync({ kind: newPlaceKind(claimed.type), name: newPlaceName(claimed.type, own(places), t) })).id;
      setMade(madeId);
      await move.mutateAsync({ deviceId: claimed.id, spaceId: madeId });
    } else if (to !== null) {
      if (spaceId !== to.id) await move.mutateAsync({ deviceId: claimed.id, spaceId: to.id });
      if (made) await end.mutateAsync(made);
      setMade((madeId = null));
    }

    // Where it hangs is the first thing asked, so what follows it is the second of the plan.
    if (to && !ownClimate && climateIn(every, to.id, claimed.id)) joined(claimed, to);
    else if (plan[1]) go(plan[1], madeId);
    else leaveTo(to?.id ?? madeId);
  };

  if (open === 'place') {
    return (
      <AirStep
        device={claimed}
        places={own(places).filter(one => one.id !== made)}
        every={every}
        step={step}
        of={of}
        headingRef={heading}
        hang={hang}
        onBack={() => void navigate(-1)}
        onLeave={leave}
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
    grow: { title: t('claim.grow.title') },
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
    <section className={styles.screen}>
      <FlowHead device={typeName(claimed.type, t)} step={step} of={of} titled onClose={leave} />

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
    <section className={styles.screen}>
      <h1>{t('claim.title')}</h1>
      <p className={`${ui.cardDashed} ${styles.demoNote}`}>{t('claim.demo')}</p>
      <Link className={ui.button} to="/">
        {t('claim.backToStart')}
      </Link>
    </section>
  );
}
