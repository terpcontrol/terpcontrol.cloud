import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useClaimedDevice } from '@/api/claims';
import { useSocketTables } from '@/api/devices';
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
import { doingSummary, hardwareSummary, NOTHING_DOING, placeSummary, type Doing } from './steps';
import styles from './Claim.module.css';

/** The four steps, in order, so the bottom button can carry the next one's name. */
const STEPS = ['code', 'place', 'doing', 'hardware'] as const;

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
 * The device's own words are what the first step reports, read again on a beat,
 * because a controller that has just been given Wi-Fi comes online while this
 * screen is open and "not heard from yet" is only true until it does.
 */
export function Claim() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useNow();
  const mayManage = useMayManage();
  const [params] = useSearchParams();

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  // The furthest step opened, so that going back to correct the tent's name
  // does not turn the two steps after it back into questions nobody answered.
  const [seen, setSeen] = useState(0);
  const [doing, setDoing] = useState<Doing>(NOTHING_DOING);

  const device = useClaimedDevice(deviceId);
  const spaces = useSpaces();
  const tables = useSocketTables(deviceId ? [deviceId] : []);
  const sockets = deviceId ? tables.tables.get(deviceId) : undefined;

  const claimed = device.data ?? null;
  const spaceId = claimed?.spaceId ?? null;
  const space = spaces.data?.items.find(one => one.id === spaceId) ?? null;

  if (!mayManage) return <OnlyLooking />;

  const leave = () => void navigate(spaceId ? `/spaces/${spaceId}` : '/', { replace: true });
  const go = (index: number) => {
    setAt(index);
    setSeen(furthest => Math.max(furthest, index));
  };
  const stateOf = (index: number) => (index === at ? 'open' : index <= seen ? 'done' : 'ahead');
  const said = (index: number, summary: string, question: string) => (stateOf(index) === 'done' ? summary : question);

  return (
    <section className={styles.screen}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t('claim.title', { step: at + 1, of: STEPS.length })}</h1>
        <button type="button" className={styles.skip} onClick={leave}>
          {t('claim.skip')}
        </button>
      </header>

      <div className={styles.progress} aria-hidden>
        {STEPS.map((step, index) => (
          <span key={step} className={styles.segment} data-filled={index <= at} />
        ))}
      </div>

      {deviceId && device.isPending ? <Waiting lines={2} /> : null}
      {deviceId && !device.data && device.isError ? <LoadFailed retry={() => void device.refetch()} /> : null}
      {device.data && device.isError ? <RefreshFailed failedAt={device.dataUpdatedAt} now={now} /> : null}

      <Step
        number={1}
        state={stateOf(0)}
        onOpen={() => go(0)}
        title={claimed ? <ClaimedTitle device={claimed} /> : t('claim.code.title')}
        text={claimed ? <ClaimedFacts device={claimed} sockets={sockets} now={now} /> : t('claim.code.text')}
      >
        {claimed ? null : (
          <CodeStep
            initialCode={params.get('code') ?? ''}
            onClaimed={result => {
              setDeviceId(result.device.id);
              go(1);
            }}
          />
        )}
      </Step>

      <Step
        number={2}
        state={stateOf(1)}
        onOpen={() => go(1)}
        title={t('claim.place.title')}
        text={said(1, placeSummary(space, t), t('claim.place.text'))}
      >
        <PlaceStep space={space} />
      </Step>

      <Step
        number={3}
        state={stateOf(2)}
        onOpen={() => go(2)}
        title={t('claim.doing.title')}
        text={said(2, doingSummary(doing, t), t('claim.doing.text'))}
      >
        <DoingStep spaceId={spaceId} doing={doing} onDoing={setDoing} />
      </Step>

      <Step
        number={4}
        state={stateOf(3)}
        onOpen={() => go(3)}
        title={t('claim.hardware.title')}
        text={said(3, hardwareSummary(claimed, sockets, t), t('claim.hardware.text'))}
      >
        <HardwareStep device={claimed} sockets={sockets} spaceId={spaceId} />
      </Step>

      <footer className={styles.foot}>
        <button
          type="button"
          className={`${ui.button} ${deviceId ? ui.primary : ''} ${styles.wide}`}
          disabled={deviceId === null}
          onClick={() => (at + 1 < STEPS.length ? go(at + 1) : leave())}
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
      <h1 className={styles.title}>{t('claim.title', { step: 1, of: STEPS.length })}</h1>
      <p className={`${ui.cardDashed} ${styles.demoNote}`}>{t('claim.demo')}</p>
      <Link className={ui.button} to="/devices">
        {t('claim.backToDevices')}
      </Link>
    </section>
  );
}
