import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Device } from '@fg2/shared-types/v1';
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
import { PlaceStep } from './PlaceStep';
import { Step } from './Step';
import { doingSummary, hardwareSummary, MEASURE, newPlaceName, NOTHING_DOING, placeSummary, type Doing } from './steps';
import styles from './Claim.module.css';

/** The four steps, in order, so the bottom button can carry the next one's name. */
const STEPS = ['code', 'place', 'doing', 'hardware'] as const;

/**
 * Which step the address says was open, kept inside the four. Without a device
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
 * Adding a device: the four things that have to be true before a controller is
 * of any use, asked in the order they can be answered.
 *
 * It is a screen of its own rather than a sheet because it is the one stretch
 * of the app where somebody is standing in a room with hardware in their hands,
 * and because every one of its four answers is written the moment it is given -
 * there is no Save at the end and nothing is lost by leaving. That is what the
 * skip in the corner and the note under the button both say: the claim is the
 * only step that has to happen here, and the other three are the ordinary
 * screens, reached from Devices and from the tent's Control tab.
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
  const at = lost ? 0 : step;
  const seen = lost ? 0 : furthest;

  // Where the keyboard and the screen reader are put when a step settles: the
  // heading of the question that just opened, which without this is nowhere at
  // all - the form that was focused has been taken off the page.
  const codeHeading = useRef<HTMLHeadingElement>(null);
  const placeHeading = useRef<HTMLHeadingElement>(null);
  const doingHeading = useRef<HTMLHeadingElement>(null);
  const hardwareHeading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) [codeHeading, placeHeading, doingHeading, hardwareHeading][at]?.current?.focus();
    moved.current = true;
  }, [at]);

  if (!mayManage) return <OnlyLooking />;

  const leave = () => void navigate(spaceId ? `/spaces/${spaceId}` : '/', { replace: true });
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
      if (at + 1 < STEPS.length) go(at + 1);
      else leave();
      return;
    }

    apply.mutate(
      { stage: pending },
      {
        onSuccess: result => {
          setDoing({ chosen: pending, applied: result });
          // What to do about the grow is the server's own question and it has
          // only just been asked, so the step stays open to be answered.
          if (!result.growDecisionNeeded) go(at + 1);
        },
      },
    );
  };

  return (
    <section className={styles.screen}>
      <header className={styles.head}>
        <h1 className={styles.title}>{stepped(t('claim.title', { step: at + 1, of: STEPS.length }))}</h1>
        <button type="button" className={styles.skip} onClick={leave}>
          {t('claim.skip')}
        </button>
      </header>

      {/* Nothing announces a step change on its own: the heading's text swaps and
          `aria-current` moves, neither of which is read out. This says what has
          just opened, and stays empty until something has. */}
      <p className={styles.announce} role="status">
        {at > 0 ? t('claim.opened', { title: t(`claim.${STEPS[at]}.title`), step: at + 1, of: STEPS.length }) : ''}
      </p>

      <div className={styles.progress} aria-hidden>
        {STEPS.map((step, index) => (
          <span key={step} className={styles.segment} data-filled={index <= at} />
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

      <Step
        number={4}
        state={stateOf(3)}
        onOpen={() => go(3)}
        headingRef={hardwareHeading}
        title={t('claim.hardware.title')}
        text={said(3, hardwareSummary(claimed, sockets, t), t('claim.hardware.text'))}
      >
        <HardwareStep device={claimed} sockets={sockets} />
      </Step>

      <footer className={styles.foot}>
        <button
          type="button"
          className={`${ui.button} ${deviceId && !lost ? ui.primary : ''} ${styles.wide}`}
          disabled={deviceId === null || lost || apply.isPending}
          onClick={onward}
        >
          {at + 1 < STEPS.length ? t('claim.next', { what: t(`claim.${STEPS[at + 1]}.next`) }) : t('claim.finish')}
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
      <h1 className={styles.title}>{stepped(t('claim.title', { step: 1, of: STEPS.length }))}</h1>
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
