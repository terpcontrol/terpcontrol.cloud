import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Logo } from '@/ui/Logo';
import ui from '@/ui/ui.module.css';
import styles from './SignIn.module.css';

/** The card every page outside the shell stands in: the logo, a step's title where it has one, and the form. */
export function Door({ title, onSubmit, children }: { title?: string; onSubmit?: () => void; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <form
        className={styles.card}
        noValidate
        onSubmit={event => {
          event.preventDefault();
          onSubmit?.();
        }}
      >
        <h1 className={styles.wordmark}>
          <Logo />
        </h1>
        {title ? <h2 className={styles.step}>{title}</h2> : null}
        {children}
      </form>
    </main>
  );
}

/** What went wrong, under the fields it is about; nothing while nothing has. */
export function Problem({ children }: { children: ReactNode }) {
  if (!children) return null;

  return (
    <p className={`${ui.problem} ${styles.problem}`} role="alert">
      {children}
    </p>
  );
}

/** The way back to the sign-in, at the foot of a door that is not the sign-in. */
export function BackToSignIn() {
  const { t } = useTranslation();

  return (
    <p className={styles.links}>
      <Link to="/sign-in">{t('login.backToLogin')}</Link>
    </p>
  );
}

/** The code the activation mail carries, typed as it is printed. */
export function CodeField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const { t } = useTranslation();

  return (
    <>
      <label className={`label ${styles.fieldLabel}`} htmlFor="activation-code">
        {t('login.signUp.activation.code')}
      </label>
      <input
        id="activation-code"
        className={`mono ${ui.input}`}
        autoComplete="one-time-code"
        autoCapitalize="none"
        spellCheck={false}
        disabled={disabled}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </>
  );
}
