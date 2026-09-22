import { ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { DeviceClaimCreate, DeviceClaimResult } from '@fg2/shared-types/v1';
import { claimCodeOf, useClaimDevice } from '@/api/claims';
import { ApiError } from '@/api/problem';
import { session } from '@/api/session';
import { ageLabel } from '@/ui/age';
import { canScan } from '@/ui/barcode';
import { QrScanner } from '@/ui/QrScanner';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import styles from './EmptyHome.module.css';

/**
 * The home before a grower has anything: a grow first, a device second, the
 * demo third. Nothing is asked about who the person is; the two doors lead to
 * the same place.
 */
export function EmptyHome({
  claimed,
  onClaimed,
  onStartGrow,
}: {
  claimed: DeviceClaimResult | null;
  onClaimed: (result: DeviceClaimResult) => void;
  /** The sheet belongs to the home: a grow, or a place made on the way to one, is what stops this screen being drawn at all. */
  onStartGrow: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className={styles.screen}>
      <header className={styles.intro}>
        <h1 className={styles.title}>{t('home.empty.title')}</h1>
        <p className={styles.text}>{t('home.empty.text')}</p>
      </header>

      <StartGrow onOpen={onStartGrow} />
      <AddDevice claimed={claimed} onClaimed={onClaimed} />
      <TryDemo />

      <p className={styles.following}>{t('home.empty.following')}</p>
    </section>
  );
}

/**
 * The first door, and the one that needs no hardware at all. It only asks: the
 * sheet it opens outlives this card, because the first thing that sheet makes -
 * a grow, or the place to put it in - is what the home stops being empty by.
 */
function StartGrow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const mayManage = useMayManage();

  return (
    <article className={ui.card}>
      <h2 className={styles.cardTitle}>{t('home.startGrow.title')}</h2>
      <p className={styles.cardText}>{t('home.startGrow.text')}</p>
      <div className={styles.actions}>
        {mayManage ? (
          <button type="button" className={ui.button} onClick={onOpen}>
            {t('home.startGrow.button')}
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
          </button>
        ) : (
          <span className={ui.note}>{t('grow.new.readOnly')}</span>
        )}
      </div>
    </article>
  );
}

function AddDevice({ claimed, onClaimed }: { claimed: DeviceClaimResult | null; onClaimed: (result: DeviceClaimResult) => void }) {
  const { t } = useTranslation();
  const claim = useClaimDevice();
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const form = useForm<DeviceClaimCreate>({ defaultValues: { code: '' } });

  const submit = form.handleSubmit(async body => {
    try {
      onClaimed(await claim.mutateAsync({ code: body.code.trim() }));
    } catch (error) {
      form.setError('code', { message: claimProblem(error, t) });
    }
  });

  const scan = () => {
    if (!canScan()) return setScanNote(t('home.addDevice.scanUnavailable'));
    setScanNote(null);
    setScanning(true);
  };

  const onCode = useCallback(
    (value: string) => {
      setScanning(false);
      form.setValue('code', claimCodeOf(value));
      void submit();
    },
    [form, submit],
  );
  const closeScanner = useCallback(() => setScanning(false), []);

  const problem = form.formState.errors.code?.message ?? scanNote;

  return (
    <article className={ui.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{t('home.addDevice.title')}</h2>
        {claimed ? null : (
          <button type="button" className={ui.chip} onClick={scan}>
            {t('home.addDevice.scan')}
          </button>
        )}
      </div>
      <p className={styles.cardText}>{t('home.addDevice.text')}</p>

      {claimed ? (
        <Claimed result={claimed} />
      ) : (
        <form onSubmit={submit} noValidate>
          <div className={ui.fieldRow}>
            <input
              className={`mono ${ui.input}`}
              placeholder={t('home.addDevice.code')}
              aria-label={t('home.addDevice.code')}
              autoCapitalize="characters"
              autoComplete="off"
              enterKeyHint="go"
              spellCheck={false}
              aria-invalid={problem ? true : undefined}
              disabled={claim.isPending}
              {...form.register('code', { required: true })}
            />
            <button type="button" className={ui.fieldAction} onClick={scan}>
              {t('home.addDevice.orScan')}
              <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          {problem ? (
            <p className={`${ui.problem} ${styles.problem}`} role="alert">
              {problem}
            </p>
          ) : null}
          {claim.isPending ? <p className={`${ui.note} ${styles.problem}`}>{t('home.addDevice.claiming')}</p> : null}
        </form>
      )}

      {scanning ? <QrScanner onCode={onCode} onClose={closeScanner} /> : null}
    </article>
  );
}

/** What the claim came back with, until the steps that follow it are built. */
function Claimed({ result }: { result: DeviceClaimResult }) {
  const { t } = useTranslation();
  const now = useNow();
  const { device, spaceCreated } = result;
  const heardAt = device.state.lastSeenAt;

  return (
    <div className={styles.claimed} role="status">
      <div className={styles.claimedLine}>
        <span className={styles.claimedMark}>{t('home.addDevice.claimed')}</span> · {device.name ?? device.type} ·{' '}
        <span className="mono">{device.id.slice(-4).toUpperCase()}</span>
      </div>
      <div className={`mono ${styles.claimedNote}`}>
        {heardAt ? t('home.addDevice.heard', { age: ageLabel(heardAt, now) }) : t('home.addDevice.notHeard')}
        {spaceCreated ? ` · ${t('home.addDevice.spaceCreated')}` : ''}
      </div>
    </div>
  );
}

/** The demo is a session of its own: opening it means leaving this one. */
function TryDemo() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'opening' | 'failed'>('idle');

  const open = async () => {
    setState('opening');
    try {
      await session.openDemo();
      await navigate('/', { replace: true });
    } catch {
      setState('failed');
    }
  };

  return (
    <article className={`${ui.cardDashed} ${styles.demo}`}>
      <button type="button" className={styles.demoButton} onClick={open} disabled={state === 'opening'}>
        <h2 className={styles.cardTitle}>{t('home.demo.title')}</h2>
        <p className={styles.cardText}>{t('home.demo.text')}</p>
      </button>
      {state === 'opening' ? <p className={ui.note}>{t('home.demo.opening')}</p> : null}
      {state === 'failed' ? (
        <p className={ui.problem} role="alert">
          {t('home.demo.failed')}
        </p>
      ) : null}
    </article>
  );
}

const claimProblem = (error: unknown, t: (key: string) => string): string => {
  if (!(error instanceof ApiError)) return t('login.messages.connectionError');
  if (error.problem.code === 'claim_code_unknown') return t('onboarding.claimFailed');
  if (error.problem.code === 'device_claimed') return t('home.addDevice.alreadyClaimed');
  return error.problem.detail || error.problem.title;
};
