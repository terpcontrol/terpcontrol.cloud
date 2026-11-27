import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { meKey, useAcceptTerms } from '@/api/account';
import { refusalCode } from '@/api/problem';
import { useLeave } from '@/ui/leave';
import { refusalText } from '@/ui/refusal';
import ui from '@/ui/ui.module.css';
import { Door, Problem } from './Door';
import styles from './SignIn.module.css';

/**
 * The one box that makes the install's terms of use a contract: being of age
 * and accepting them are confirmed together, and the terms open beside it.
 */
export function TermsConsent({
  url,
  checked,
  disabled,
  missing,
  onChange,
}: {
  url: string;
  checked: boolean;
  disabled: boolean;
  missing: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <label className={styles.agree}>
      <input type="checkbox" checked={checked} disabled={disabled} aria-invalid={missing} onChange={event => onChange(event.target.checked)} />
      <span>
        {t('login.terms.acceptBefore')}{' '}
        <a href={url} target="_blank" rel="noopener noreferrer">
          {t('login.terms.acceptLink')}
        </a>
        {t('login.terms.acceptAfter')}
      </span>
    </label>
  );
}

/**
 * What an account sees instead of the app while the install's terms of use are
 * new to it - it signed up before there were any, or they have changed since.
 * The server names the terms (`Me.termsToAccept`); accepting them answers the
 * account with nothing left to accept, and the shell is drawn. Terms that
 * changed again while this stood open are read anew rather than accepted
 * unseen.
 */
export function TermsGate({ url }: { url: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const accept = useAcceptTerms();
  const { leaving, leave } = useLeave('/sign-in');
  const [checked, setChecked] = useState(false);
  const [missing, setMissing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    if (!checked) {
      setMissing(true);
      return;
    }
    try {
      await accept.mutateAsync({ url });
    } catch (error) {
      setProblem(refusalText(error));
      if (refusalCode(error) === 'terms_changed') {
        setChecked(false);
        await client.invalidateQueries({ queryKey: meKey });
      }
    }
  };

  const busy = accept.isPending || leaving;

  return (
    <Door title={t('login.terms.gate.title')} onSubmit={() => void submit()}>
      <p className={styles.intro}>{t('login.terms.gate.body')}</p>

      <TermsConsent
        url={url}
        checked={checked}
        disabled={busy}
        missing={missing && !checked}
        onChange={next => {
          setChecked(next);
          setMissing(false);
        }}
      />
      {missing && !checked ? <p className={`${ui.problem} ${styles.fieldNote}`}>{t('login.terms.needed')}</p> : null}

      <Problem>{problem}</Problem>

      <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={busy}>
        {t('login.terms.gate.submit')}
      </button>

      <p className={styles.links}>
        <button type="button" className={styles.textButton} disabled={busy} onClick={() => void leave()}>
          {t('me.signOut')}
        </button>
      </p>
    </Door>
  );
}
