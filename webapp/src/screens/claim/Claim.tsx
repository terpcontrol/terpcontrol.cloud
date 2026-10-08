import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { placePath } from '@/app/places';
import type { Device } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useMe } from '@/api/account';
import { useClaimedDevice, useNameNewPlace } from '@/api/claims';
import { useSocketTables } from '@/api/devices';
import { useSpaceGrows } from '@/api/grows';
import { useApplyPreset } from '@/api/lifecycle';
import { ApiError } from '@/api/problem';
import { useSpaces } from '@/api/spaces';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { ClaimedFacts, ClaimedTitle, CodeStep } from './CodeStep';
import { DoingStep } from './DoingStep';
import { HardwareStep } from './HardwareStep';
import { pairsACam } from '@/screens/camera/add/pairers';
import { NotifyStep } from '@/screens/notifications/NotifyNotice';
import { PlaceStep } from './PlaceStep';
import { Step } from './Step';
import { doingSummary, hardwareSummary, MEASURE, newPlaceName, NOTHING_DOING, notifySummary, placeSummary, presetBodyOf, type Doing } from './steps';
import styles from './Claim.module.css';

/** The steps, in order, so the bottom button can carry the next one's name. */
const STEPS = ['code', 'place', 'doing', 'hardware', 'notify'] as const;

/**
 * Which step the address says was open, kept inside the five. Without a device
 * there is nothing to resume and the first question is the only one that can be
 * asked.
 */
const stepIn = (params: URLSearchParams): number => {
  if (!params.get('device')) return 0;
  const raw = params.get('at');
  const at = raw === null ? 1 : Number(raw);

  return Number.isInteger(at) && at >= 0 && at < STEPS.length ? at : 1;
};

/**
 * Adding a device: the five things that have to be true before a controller is
 * of any use, asked in the order they can be answered - the last of them being
 * that somebody hears when it goes wrong.
 *
 * It is a screen of its own rather than a sheet because it is the one stretch
 * of the app where somebody is standing in a room with hardware in their hands,
 * and because every one of its five answers is written the moment it is given -
 * there is no Save at the end and nothing is lost by leaving. That is what the
 * skip in the corner and the note under the button both say: the claim is the
 * only step that has to happen here, and the other four are the ordinary
 * screens, reached from Devices, from the tent's Control tab and from Me.
 *
 * Which device was claimed, and which question was open, live in the address
 * rather than in this component, because the phone in that room locks, drops
 * the tab and follows links out of the flow. A claim spends the code on the
 * display, so a screen that came back asking for it again would be asking for
 * something that no longer exists.
 *
 * The device's own words are what the first step reports, read again on a beat,
 * because a controller that has just been given Wi-Fi comes online while this
 * screen is open and "not heard from yet" is only true until it does.
 */
export function Claim() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useNow();
  const mayManage = useMayManage();
  const [params, setParams] = useSearchParams();

  const [deviceId, setDeviceId] = useState<string | null>(() => params.get('device'));
  const [step, setStep] = useState(() => stepIn(params));
  // The furthest step opened, so that going back to correct the tent's name
  // does not turn the two steps after it back into questions nobody answered.
  const [furthest, setFurthest] = useState(() => stepIn(params));
  const [doing, setDoing] = useState<Doing>(NOTHING_DOING);
  // The space this claim invented, if it invented one: it holds this device and
  // nothing else, so it is the one that may be archived if the device turns out
  // to belong in a place the account already had.
  const [invented, setInvented] = useState<string | null>(null);

  const device = useClaimedDevice(deviceId);
  const spaces = useSpaces();
  const tables = useSocketTables(deviceId ? [deviceId] : []);
  const sockets = deviceId ? tables.tables.get(deviceId) : undefined;
  const namePlace = useNameNewPlace();
  const me = useMe(false, mayManage);

  const claimed = device.data ?? null;
  const spaceId = claimed?.spaceId ?? null;
  const places = spaces.data?.items ?? [];
  const space = places.find(one => one.id === spaceId) ?? null;
  const apply = useApplyPreset(spaceId ?? '');
  // What the place is on according to the server, for the step that was
  // answered on a phone that has since been locked: the choice made here is
  // this component's and does not survive the reload the address does.
  const growsHere = useSpaceGrows(spaceId);
  const onServer =
    spaceId === null || !growsHere.isPending ? (growsHere.data?.items.find(grow => grow.endedAt === null)?.summary.stage ?? null) : undefined;

  // A device id in the address that this account cannot read - stale, or
  // somebody else's - would leave the screen failing to load with no field to
  // type a code into, so the flow falls back to its first question and offers
  // the field again. A server that could not be reached at all is a different
  // thing and keeps its retry.
  const lost = device.error instanceof ApiError && !device.data;
  // Sockets and a cam are paired at a fridge module or a controller, a cam alone
  // at a smart socket or an AIR fan; a LIGHT has neither and is not asked.
  const camOnly = claimed !== null && !SOCKET_HOST_TYPES.includes(claimed.type);
  const shown = STEPS.flatMap((name, index) => (name === 'hardware' && claimed && !pairsACam(claimed) ? [] : [index]));
  // What a step is called, which for the fourth depends on what the device pairs.
  const keyOf = (index: number): string => (STEPS[index] === 'hardware' && camOnly ? 'camOnly' : STEPS[index]);
  const hidden = (index: number) => !shown.includes(index);
  const at = lost ? 0 : hidden(step) ? step + 1 : step;
  const seen = lost ? 0 : furthest;
  const position = shown.indexOf(at) + 1;
  const after = shown[shown.indexOf(at) + 1] ?? null;

  // Where the keyboard and the screen reader are put when a step settles: the
  // heading of the question that just opened, which without this is nowhere at
  // all - the form that was focused has been taken off the page.
  const codeHeading = useRef<HTMLHeadingElement>(null);
  const placeHeading = useRef<HTMLHeadingElement>(null);
  const doingHeading = useRef<HTMLHeadingElement>(null);
  const hardwareHeading = useRef<HTMLHeadingElement>(null);
  const notifyHeading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) [codeHeading, placeHeading, doingHeading, hardwareHeading, notifyHeading][at]?.current?.focus();
    moved.current = true;
  }, [at]);

  if (!mayManage) return <OnlyLooking />;

  const leave = () => void navigate(spaceId ? placePath(spaceId) : '/', { replace: true });
  const go = (index: number, claimedId = deviceId) => {
    setStep(index);
    setFurthest(was => Math.max(was, index));
    if (claimedId) setParams({ device: claimedId, at: String(index) }, { replace: true });
  };
  const stateOf = (index: number) => (index === at ? 'open' : index <= seen ? 'done' : 'ahead');
  const said = (index: number, summary: string, question: string) => (stateOf(index) === 'done' ? summary : question);

  /**
   * Naming the place a claim has just made. The word is the app's and not the
   * server's, because a name has to be in the language the grower reads and
   * the server has none, and the number is counted past the places this
   * account already has - a list still on its way is waited for rather than
   * read as empty, which would call every claim "Tent 1".
   */
  const namePlaceOf = async (made: Device) => {
    if (!made.spaceId) return;
    const items = spaces.data?.items ?? (await spaces.refetch()).data?.items ?? [];
    namePlace.mutate({ spaceId: made.spaceId, name: newPlaceName(made.type, items, t) });
  };

  // A stage picked on the third step but not yet written. The bottom button is
  // where every step is left, so leaving this one carries the choice into the
  // write rather than dropping it.
  const pending = at === 2 && doing.chosen !== null && doing.chosen !== MEASURE && doing.applied === null ? doing.chosen : null;
  const onward = () => {
    if (!pending || !spaceId) {
      if (after !== null) go(after);
      else leave();
      return;
    }

    apply.mutate(presetBodyOf(pending, doing), {
      onSuccess: result => {
        setDoing({ ...doing, chosen: pending, applied: result });
        // What to do about the grow is the server's own question and it has
        // only just been asked, so the step stays open to be answered.
        if (!result.growDecisionNeeded && after !== null) go(after);
      },
    });
  };

  return (
    <section className={styles.screen}>
      <header className={styles.head}>
        <h1>{stepped(t('claim.title', { step: position, of: shown.length }))}</h1>
        <button type="button" className={styles.skip} onClick={leave}>
          {t('claim.skip')}
        </button>
      </header>

      {/* Nothing announces a step change on its own: the heading's text swaps and
          `aria-current` moves, neither of which is read out. This says what has
          just opened, and stays empty until something has. */}
      <p className={ui.visuallyHidden} role="status">
        {at > 0 ? t('claim.opened', { title: t(`claim.${keyOf(at)}.title`), step: position, of: shown.length }) : ''}
      </p>

      <div className={styles.progress} aria-hidden>
        {shown.map(index => (
          <span key={STEPS[index]} className={styles.segment} data-filled={index <= at} />
        ))}
      </div>

      {deviceId && device.isPending ? <Waiting lines={2} /> : null}
      {deviceId && !device.data && device.isError && !lost ? <LoadFailed retry={() => void device.refetch()} /> : null}
      {device.data && device.isError ? <RefreshFailed failedAt={device.dataUpdatedAt} now={now} /> : null}

      <Step
        number={1}
        state={stateOf(0)}
        onOpen={() => go(0)}
        headingRef={codeHeading}
        title={claimed ? <ClaimedTitle device={claimed} /> : t('claim.code.title')}
        text={claimed ? <ClaimedFacts device={claimed} sockets={sockets} now={now} /> : t('claim.code.text')}
      >
        {claimed ? null : (
          <CodeStep
            initialCode={params.get('code') ?? ''}
            places={places}
            onClaimed={result => {
              setDeviceId(result.device.id);
              go(1, result.device.id);
              if (result.spaceCreated) {
                setInvented(result.device.spaceId);
                void namePlaceOf(result.device);
              }
            }}
          />
        )}
      </Step>

      <Step
        number={2}
        state={stateOf(1)}
        onOpen={() => go(1)}
        headingRef={placeHeading}
        title={t('claim.place.title')}
        text={said(1, placeSummary(space, t), t('claim.place.text'))}
      >
        <PlaceStep space={space} places={places} deviceId={deviceId} invented={invented} />
      </Step>

      <Step
        number={3}
        state={stateOf(2)}
        onOpen={() => go(2)}
        headingRef={doingHeading}
        title={t('claim.doing.title')}
        text={said(2, doingSummary(doing, onServer, t) ?? t('claim.doing.text'), t('claim.doing.text'))}
      >
        <DoingStep spaceId={spaceId} doing={doing} onDoing={setDoing} apply={apply} />
      </Step>

      {hidden(3) ? null : (
        <Step
          number={4}
          state={stateOf(3)}
          onOpen={() => go(3)}
          headingRef={hardwareHeading}
          title={t(`claim.${keyOf(3)}.title`)}
          text={said(3, hardwareSummary(claimed, sockets, t, camOnly), t(`claim.${keyOf(3)}.text`))}
        >
          <HardwareStep device={claimed} sockets={sockets} camOnly={camOnly} />
        </Step>
      )}

      {/* Last, because it is about every device rather than this one, and
          because an alarm nobody hears is the one thing a new device cannot
          be left with: the device-offline rule is armed from the claim on. */}
      <Step
        number={shown.indexOf(4) + 1}
        state={stateOf(4)}
        onOpen={() => go(4)}
        headingRef={notifyHeading}
        title={t('claim.notify.title')}
        text={said(4, notifySummary(me.data, t) ?? t('claim.notify.text'), t('claim.notify.text'))}
      >
        <NotifyStep me={me.data} />
      </Step>

      <footer className={styles.foot}>
        <button
          type="button"
          className={`${ui.button} ${deviceId && !lost ? ui.primary : ''} ${styles.wide}`}
          disabled={deviceId === null || lost || apply.isPending}
          onClick={onward}
        >
          {after !== null ? t('claim.next', { what: t(`claim.${keyOf(after)}.next`) }) : t('claim.finish')}
        </button>
        <p className={`${ui.note} ${styles.laterNote}`}>{t('claim.later')}</p>
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
      <h1>{stepped(t('claim.title', { step: 1, of: STEPS.length }))}</h1>
      <p className={`${ui.cardDashed} ${styles.demoNote}`}>{t('claim.demo')}</p>
      <Link className={ui.button} to="/devices">
        {t('claim.backToDevices')}
      </Link>
    </section>
  );
}

/**
 * The title and its step count, the count set as a smaller part of its own:
 * wrapped as one string, a phone started the second line on the separator
 * ("· 1 of 4"). On a phone the count takes the line under the title and the
 * separator goes.
 */
function stepped(title: string) {
  const at = title.lastIndexOf(' · ');
  if (at < 0) return title;
  return (
    <>
      {title.slice(0, at)}
      <span className={styles.stepSeparator}> · </span>
      <span className={styles.stepCount}>{title.slice(at + 3)}</span>
    </>
  );
}
