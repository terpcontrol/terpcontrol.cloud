import { useState } from 'react';
import { useForm } from 'react-hook-form';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import type { UserCreate } from '@fg2/shared-types/v1';
import { useActivateAccount, useSignUp } from '@/api/account';
import { CUSTOM_LINKS_HTML, PRIVACY_URL, TERMS_URL } from '@/api/config';
import { ApiError } from '@/api/problem';
import { session, useSession } from '@/api/session';
import { typedHandle } from '@/ui/handle';
import ui from '@/ui/ui.module.css';
import { CodeField, Door, Problem } from './Door';
import { TermsConsent } from './TermsGate';
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
 * up - the tent is where they were going, and a Start with nothing on
 * it is not.
 *
 * Whether an account may sign in at once is the server's answer, not an
 * assumption: an install may ask for the account to be activated with the
 * code from its mail first, and then this page says so, takes the code, and
 * goes on from there. The credentials are held only until that sign-in and
 * live nowhere but in this page's state.
 *
 * An install with terms of use has them accepted here, with being of age, in
 * one box the server records; its privacy statement is linked as what it is,
 * information, and never asked to be agreed to.
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
  // An address that has an account already: the refusal leads to signing in with it.
  const [taken, setTaken] = useState(false);
  const [awaiting, setAwaiting] = useState<UserCreate | null>(null);
  const [activationCode, setActivationCode] = useState('');
  // Whether the session about to appear is the one this page just made. The
  // sign-in publishes the user and this page then leaves; the word that the
  // invitation may be taken up travels with that leaving, and only when the
  // account was made here for it - somebody already signed in who lands on
  // this page is simply sent on.
  const [entering, setEntering] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [unaccepted, setUnaccepted] = useState(false);
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
    setTaken(false);
    if (TERMS_URL && !accepted) {
      setUnaccepted(true);
      return;
    }
    const credentials: UserCreate = { ...body, handle: typedHandle(body.handle), ...(TERMS_URL ? { acceptTerms: true } : {}) };
    try {
      const account = await signUp.mutateAsync(credentials);
      if (account.isActive) await enter(credentials);
      else setAwaiting(credentials);
    } catch (error) {
      if (error instanceof ApiError) {
        // A refusal about one field is said at that field, in the catalogue's words where it has them.
        const coded = `problem.code.${error.problem.code}`;
        const atField = error.problem.errors.length > 0 && i18next.exists(coded);
        for (const [field, detail] of Object.entries(error.fieldErrors)) {
          form.setError(field as keyof UserCreate, { message: atField ? t(coded) : detail });
        }
        setProblem(atField ? null : refusalText(error));
        setTaken(error.problem.code === 'email_taken');
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
      <Door title={t('login.signUp.activation.title')} onSubmit={() => void activateThenEnter()}>
        <p className={styles.intro}>{t('login.signUp.activation.body', { email: awaiting.email })}</p>

        <CodeField value={activationCode} disabled={busy} onChange={setActivationCode} />

        <Problem>{problem}</Problem>

        <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={busy || activationCode.trim() === ''}>
          {t('login.signUp.activation.submit')}
        </button>

        <p className={styles.links}>
          {t(invitation ? 'login.signUp.activation.laterInvited' : 'login.signUp.activation.later')}{' '}
          <Link to="/sign-in" state={{ from: destination }}>
            {t('login.signIn')}
          </Link>
        </p>
      </Door>
    );
  }

  return (
    <Door page={t('login.createAccount')} onSubmit={() => void submit()}>
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
        minLength={PASSWORD_MIN_LENGTH}
        {...form.register('password', { required: true })}
      />
      <p className={`${ui.note} ${styles.fieldNote}`}>{t('login.signUp.passwordNote')}</p>
      <FieldProblem message={errors.password?.message} />

      {TERMS_URL ? (
        <>
          <TermsConsent
            url={TERMS_URL}
            checked={accepted}
            disabled={busy}
            missing={(unaccepted && !accepted) || !!errors.acceptTerms}
            onChange={checked => {
              setAccepted(checked);
              setUnaccepted(false);
              form.clearErrors('acceptTerms');
            }}
          />
          <FieldProblem message={unaccepted && !accepted ? t('login.terms.needed') : errors.acceptTerms?.message} />
        </>
      ) : null}

      <p className={`${ui.note} ${styles.privacyNote}`}>
        {t('login.privacyNoteBefore')}{' '}
        <a href={PRIVACY_URL || '/privacy'} target="_blank" rel="noopener noreferrer">
          {t('login.privacyNoteLink')}
        </a>
        {t('login.privacyNoteAfter')}
      </p>

      <Problem>
        {problem}
        {taken ? (
          <>
            {' '}
            <Link to="/sign-in" state={{ from: destination, email: form.getValues('email') }} className={styles.textLink}>
              {t('login.signUp.takenSignIn')}
            </Link>
          </>
        ) : null}
      </Problem>

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
    </Door>
  );
}

/** The shortest new password the server takes; it says so itself, this only says it before the form is sent. */
const PASSWORD_MIN_LENGTH = 8;

/** What the server said about one field, under that field; a form's own `required` leaves no sentence and draws nothing. */
function FieldProblem({ message }: { message: string | undefined }) {
  if (!message) return null;

  return <p className={`${ui.problem} ${styles.fieldNote}`}>{message}</p>;
}
