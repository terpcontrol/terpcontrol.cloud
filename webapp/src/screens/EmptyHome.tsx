import { ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { claimCodeOf } from '@/api/claims';
import { session, useSession } from '@/api/session';
import { canScan } from '@/ui/barcode';
import { useMayManage } from '@/ui/session-access';
import { QrScanner } from '@/ui/QrScanner';
import ui from '@/ui/ui.module.css';
import styles from './EmptyHome.module.css';

/**
 * The home before a grower has anything: a grow first, a device second, the
 * demo third. Nothing is asked about who the person is; the two doors lead to
 * the same place.
 */
export function EmptyHome({ onStartGrow }: { onStartGrow: () => void }) {
  const { t } = useTranslation();

  return (
    <section className={styles.screen}>
      <header className={styles.intro}>
        <h1 className={styles.title}>{t('home.empty.title')}</h1>
        <p className={styles.text}>{t('home.empty.text')}</p>
      </header>

      <StartGrow onOpen={onStartGrow} />
      <AddDevice />
      <TryDemo />

      <p className={styles.following}>{t('home.empty.following')}</p>
    </section>
  );
}

/** The first door, and the one that needs nothing but a name: the sheet is the home's, because what it writes is what stops this screen being drawn. */
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

/**
 * The second door, which the demo is shown and not offered: a field it could
 * type into ends in a refusal one screen later, and the reason for that refusal
 * is what the card says instead.
 */
function AddDevice() {
  const { t } = useTranslation();
  const mayManage = useMayManage();

  if (mayManage) return <ClaimCode />;

  return (
    <article className={ui.card}>
      <h2 className={styles.cardTitle}>{t('home.addDevice.title')}</h2>
      <p className={styles.cardText}>{t('home.addDevice.text')}</p>
      <p className={ui.note}>{t('claim.demo')}</p>
    </article>
  );
}

/**
 * The code is read here, with the scanner the box's QR needs, and handed to the
 * claim flow rather than spent here: claiming is the first of four steps, and a
 * card that did only that one would leave a controller owned, standing nowhere
 * in particular and doing nothing.
 */
function ClaimCode() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  const hand = useCallback(
    (value: string) => {
      const found = claimCodeOf(value);
      void navigate(found ? `/claim?code=${encodeURIComponent(found)}` : '/claim');
    },
    [navigate],
  );

  const scan = () => {
    if (!canScan()) return setScanNote(t('home.addDevice.scanUnavailable'));
    setScanNote(null);
    setScanning(true);
  };

  const onCode = useCallback(
    (value: string) => {
      setScanning(false);
      hand(value);
    },
    [hand],
  );
  const closeScanner = useCallback(() => setScanning(false), []);
  const onFailed = useCallback(() => {
    setScanning(false);
    setScanNote(t('home.addDevice.scanDenied'));
  }, [t]);

  return (
    <article className={ui.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{t('home.addDevice.title')}</h2>
        <button type="button" className={ui.chip} onClick={scan}>
          {t('home.addDevice.scan')}
        </button>
      </div>
      <p className={styles.cardText}>{t('home.addDevice.text')}</p>

      <form
        onSubmit={event => {
          event.preventDefault();
          hand(code);
        }}
        noValidate
      >
        <div className={ui.fieldRow}>
          <input
            className={`mono ${ui.input}`}
            placeholder={t('home.addDevice.code')}
            aria-label={t('home.addDevice.code')}
            autoCapitalize="characters"
            autoComplete="off"
            enterKeyHint="go"
            spellCheck={false}
            value={code}
            onChange={event => setCode(event.target.value)}
          />
          <button type="button" className={ui.fieldAction} onClick={scan}>
            {t('home.addDevice.orScan')}
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        {scanNote ? (
          <p className={`${ui.note} ${styles.problem}`} role="alert">
            {scanNote}
          </p>
        ) : null}
      </form>

      {scanning ? <QrScanner onCode={onCode} onClose={closeScanner} onFailed={onFailed} /> : null}
    </article>
  );
}

/**
 * The demo is a session of its own: opening it means leaving this one, so it is
 * not a door out of the demo and is not drawn there. Whether this is the demo
 * is the session's own answer and not a question about hardware, which is a
 * different thing and will part company with it.
 *
 * Leaving this one is the whole of what the card costs, so it is asked before
 * it is done rather than discovered afterwards. The two doors above add
 * something to the account that was just made; this one signs out of it, and
 * the way back is signing in again - which is not something to find out from
 * the Me page.
 */
function TryDemo() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useSession();
  const [state, setState] = useState<'idle' | 'asking' | 'opening' | 'failed'>('idle');

  const open = async () => {
    setState('opening');
    try {
      await session.openDemo();
      await navigate('/', { replace: true });
    } catch {
      setState('failed');
    }
  };

  if (user?.isDemo) return null;

  return (
    <article className={`${ui.cardDashed} ${styles.demo}`}>
      <button type="button" className={styles.demoButton} onClick={() => setState('asking')} disabled={state !== 'idle'}>
        <h2 className={styles.cardTitle}>{t('home.demo.title')}</h2>
        <p className={styles.cardText}>{t('home.demo.text')}</p>
      </button>
      {state === 'asking' ? (
        <div className={styles.actions}>
          <button type="button" className={ui.button} onClick={() => void open()}>
            {t('home.demo.confirm')}
          </button>
          <button type="button" className={ui.button} onClick={() => setState('idle')}>
            {t('home.demo.stay')}
          </button>
        </div>
      ) : null}
      {state === 'opening' ? <p className={ui.note}>{t('home.demo.opening')}</p> : null}
      {state === 'failed' ? (
        <p className={ui.problem} role="alert">
          {t('home.demo.failed')}
        </p>
      ) : null}
    </article>
  );
}
