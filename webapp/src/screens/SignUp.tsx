import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import type { UserCreate } from '@fg2/shared-types/v1';
import { useActivateAccount, useSignUp } from '@/api/account';
import { CUSTOM_LINKS_HTML } from '@/api/config';
import { ApiError } from '@/api/problem';
import { session, useSession } from '@/api/session';
import { Logo } from '@/ui/Logo';
import ui from '@/ui/ui.module.css';
import styles from './SignIn.module.css';
import { refusalText } from '@/ui/refusal';

/** What the page that sent somebody here says about why: where to go back to, and what is waiting there. */
interface SentFrom {
  from?: string;
  name?: string;
}

/**
 * An account of one's own: an e-mail address, a username and a password, and
 * nothing else asked.
 *
 * It exists above all for the person an invitation was sent to. They have
 * been asked into a tent, not sold an account, so the page keeps the
 * invitation's words at the top, and once the account is made it signs them
 * in and goes back to the invitation with the word that it may now be taken
 * up - the tent is where they were going, and a home screen with nothing on
 * it is not.
 *
 * Whether an account may sign in at once is the server's answer, not an
 * assumption: an install may ask for the account to be activated with the
 * code from its mail first, and then this page says so, takes the code, and
 * goes on from there. The credentials are held only until that sign-in and
 * live nowhere but in this page's state.
 */
export function SignUp() {
  const { t } = useTranslation();
  const { user } = useSession();
  const location = useLocation();
  const sent = (location.state as SentFrom | null) ?? {};
  const destination = sent.from ?? '/';
  const invitation = destination.startsWith('/join/');

  const signUp = useSignUp();
  const activate = useActivateAccount();
  const [problem, setProblem] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState<UserCreate | null>(null);
  const [activationCode, setActivationCode] = useState('');
  // Whether the session about to appear is the one this page just made. The
  // sign-in publishes the user and this page then leaves; the word that the
  // invitation may be taken up travels with that leaving, and only when the
  // account was made here for it - somebody already signed in who lands on
  // this page is simply sent on.
  const [entering, setEntering] = useState(false);
  const form = useForm<UserCreate>({ defaultValues: { email: '', handle: '', password: '' } });

  if (user) return <Navigate to={destination} replace state={entering && invitation ? { takeUp: true } : null} />;

  const enter = async (credentials: UserCreate) => {
    setEntering(true);
    try {
      await session.logIn({ email: credentials.email, password: credentials.password, stayLoggedIn: true });
    } catch {
      setEntering(false);
      setProblem(t('login.signUp.signInFailed'));
    }
  };

  const submit = form.handleSubmit(async body => {
    setProblem(null);
    // The sigil people type out of habit is not part of the name.
    const credentials = { ...body, handle: body.handle.trim().replace(/^@/, '') };
    try {
      const account = await signUp.mutateAsync(credentials);
      if (account.isActive) await enter(credentials);
      else setAwaiting(credentials);
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, detail] of Object.entries(error.fieldErrors)) form.setError(field as keyof UserCreate, { message: detail });
        setProblem(refusalText(error));
      } else {
        setProblem(t('shell.unreachable'));
      }
    }
  });

  const activateThenEnter = async () => {
    if (!awaiting) return;
    setProblem(null);
    try {
      await activate.mutateAsync({ activationCode: activationCode.trim() });
    } catch (error) {
      setProblem(refusalText(error));
      return;
    }
    await enter(awaiting);
  };

  const busy = form.formState.isSubmitting || signUp.isPending || activate.isPending;
  const errors = form.formState.errors;

  if (awaiting) {
    return (
      <main className={styles.page}>
        <form
          className={styles.card}
          onSubmit={event => {
            event.preventDefault();
            void activateThenEnter();
          }}
          noValidate
        >
          <h1 className={styles.wordmark}>
            <Logo />
          </h1>
          <h2 className={styles.step}>{t('login.signUp.activation.title')}</h2>
          <p className={styles.intro}>{t('login.signUp.activation.body', { email: awaiting.email })}</p>

          <label className={`label ${styles.fieldLabel}`} htmlFor="activation-code">
            {t('login.signUp.activation.code')}
          </label>
          <input
            id="activation-code"
            className={`mono ${ui.input}`}
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            value={activationCode}
            onChange={event => setActivationCode(event.target.value)}
          />

          {problem ? (
            <p className={`${ui.problem} ${styles.problem}`} role="alert">
              {problem}
            </p>
          ) : null}

          <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={busy || activationCode.trim() === ''}>
            {t('login.signUp.activation.submit')}
          </button>

          <p className={styles.links}>
            {t('login.signUp.activation.later')}{' '}
            <Link to="/sign-in" state={{ from: destination }}>
              {t('login.signIn')}
            </Link>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={submit} noValidate>
        <h1 className={styles.wordmark}>
          <Logo />
        </h1>
        <p className={styles.intro}>
          {invitation
            ? sent.name
              ? t('login.signUp.forInvitation', { name: sent.name })
              : t('login.signUp.forInvitationUnnamed')
            : t('login.signUp.intro')}
        </p>

        <label className={`label ${styles.fieldLabel}`} htmlFor="email">
          {t('login.email')}
        </label>
        <input
          id="email"
          className={ui.input}
          type="email"
          autoComplete="email"
          inputMode="email"
          disabled={busy}
          {...form.register('email', { required: true })}
        />
        <FieldProblem message={errors.email?.message} />

        <label className={`label ${styles.fieldLabel}`} htmlFor="handle">
          {t('login.signUp.handle')}
        </label>
        <input
          id="handle"
          className={ui.input}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          disabled={busy}
          {...form.register('handle', { required: true })}
        />
        <p className={`${ui.note} ${styles.fieldNote}`}>{t('login.signUp.handleNote')}</p>
        <FieldProblem message={errors.handle?.message} />

        <label className={`label ${styles.fieldLabel}`} htmlFor="password">
          {t('login.password')}
        </label>
        <input
          id="password"
          className={ui.input}
          type="password"
          autoComplete="new-password"
          disabled={busy}
          {...form.register('password', { required: true })}
        />
        <FieldProblem message={errors.password?.message} />

        {problem ? (
          <p className={`${ui.problem} ${styles.problem}`} role="alert">
            {problem}
          </p>
        ) : null}

        <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={busy}>
          {busy ? t('login.signUp.creating') : t('login.signUp.create')}
        </button>

        <p className={styles.links}>
          {t('login.signUp.haveOne')}{' '}
          <Link to="/sign-in" state={{ from: destination }}>
            {t('login.signIn')}
          </Link>
        </p>

        {CUSTOM_LINKS_HTML ? <div className={styles.links} dangerouslySetInnerHTML={{ __html: CUSTOM_LINKS_HTML }} /> : null}
      </form>
    </main>
  );
}

/** What the server said about one field, under that field; a form's own `required` leaves no sentence and draws nothing. */
function FieldProblem({ message }: { message: string | undefined }) {
  if (!message) return null;

  return <p className={`${ui.problem} ${styles.fieldNote}`}>{message}</p>;
}
