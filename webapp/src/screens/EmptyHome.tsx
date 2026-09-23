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
 *
 * Except for the one session this copy was never written for. An install whose
 * demo nobody has filled answers a demo session a home with no space in it, and
 * that lands here - so somebody who followed "Try the demo" to see a finished
 * grow was handed a brand-new grower's first-run screen instead, told to start
 * a grow and add a device, and then refused both in the same breath. The demo
 * is told what it actually found.
 */
export function EmptyHome({ onStartGrow }: { onStartGrow: () => void }) {
  const { t } = useTranslation();
  const { user } = useSession();

  if (user?.isDemo === true) return <NothingInTheDemo />;

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

/**
 * What the demo gets instead, on an install that has no demo to show.
 *
 * Being here is the whole of the diagnosis: this screen is drawn when the
 * session owns no space, and what a demo session owns is whatever an operator
 * has marked as the demo - so a demo that reaches this screen is one nothing
 * has been put into, and saying so is more use than repeating the promise the
 * card that led here made. Neither door above is offered, because the demo may
 * write nothing at all and a door that ends in a refusal is a door drawn for
 * nobody; the one thing it can still do is what the card says.
 *
 * The way on is signing out first rather than a link to the form: a session
 * that already exists is sent straight back off /sign-in, and the demo is a
 * session like any other.
 */
function NothingInTheDemo() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  const leave = async () => {
    setLeaving(true);
    await session.logOut();
    await navigate('/sign-in', { replace: true });
  };

  return (
    <section className={styles.screen}>
      <header className={styles.intro}>
        <h1 className={styles.title}>{t('home.demoEmpty.title')}</h1>
        <p className={styles.text}>{t('home.demoEmpty.text')}</p>
      </header>

      <article className={ui.cardDashed}>
        <h2 className={styles.cardTitle}>{t('home.demoEmpty.ownTitle')}</h2>
        <p className={styles.cardText}>{t('home.demoEmpty.ownText')}</p>
        <div className={styles.actions}>
          <button type="button" className={ui.button} disabled={leaving} onClick={() => void leave()}>
            {t('home.demoEmpty.signIn')}
          </button>
        </div>
      </article>
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
 * The second door. A session that may not write is shown the card and not the
 * field, because a field it could type into ends in a refusal one screen later
 * and the reason for that refusal is worth more than the field. The demo no
 * longer arrives here to be told so - it is answered at the top of the screen,
 * where the answer is about the whole of it rather than about one card - but
 * what is asked here is the session's standing and not which session it is, so
 * the door goes on asking it.
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
