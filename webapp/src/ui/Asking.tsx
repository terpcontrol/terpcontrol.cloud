import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ui from './ui.module.css';

/**
 * A step said before it is taken, in the place the tap was: what it will do,
 * anything it still needs (`children`), and the yes beside the way back. A
 * step that cannot be taken back answers yes in the alarm colour.
 *
 * It is in view when it is asked - the whole box, the yes included, moved as
 * little as that takes inside its sheet or page - and Escape is its way back
 * before it is anything else's: the sheet it stands in stays, with what was
 * typed into it.
 */
export function Asking({
  note,
  yes,
  danger = false,
  quiet = false,
  busy,
  onYes,
  onCancel,
  children,
}: {
  note: ReactNode;
  yes: string;
  danger?: boolean;
  /** The yes is drawn secondary: the button that asked stays the one filled green beside the question. */
  quiet?: boolean;
  busy: boolean;
  onYes: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const question = useRef<HTMLParagraphElement>(null);

  // Asked because something was pressed, often in place of it: the question takes the focus, so it is what is read.
  useEffect(() => {
    question.current?.parentElement?.scrollIntoView?.({ block: 'nearest' });
    question.current?.focus({ preventScroll: true });
  }, []);
  // Heard on the way down, before the sheet's own Escape on the way up.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && (event.stopPropagation(), onCancel());
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  return (
    <div className={ui.asking}>
      <p className={ui.note} ref={question} tabIndex={-1}>
        {note}
      </p>
      {children}
      <div className={ui.wrap}>
        <Answer yes={yes} danger={danger} quiet={quiet} disabled={busy} onYes={onYes} onCancel={onCancel} />
      </div>
    </div>
  );
}

/**
 * The answer to every question, inline or in a sheet's foot: the yes, and "Abbrechen" beside it - in the alarm
 * colour where the step cannot be taken back, at a control's height and radius like every other button.
 */
export function Answer({
  yes,
  danger = false,
  quiet = false,
  disabled = false,
  onYes,
  onCancel,
}: {
  yes: string;
  danger?: boolean;
  quiet?: boolean;
  disabled?: boolean;
  onYes: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <button type="button" className={`${ui.button} ${danger ? ui.dangerFilled : quiet ? '' : ui.primary}`} disabled={disabled} onClick={onYes}>
        {yes}
      </button>
      <button type="button" className={ui.button} onClick={onCancel}>
        {t('asking.cancel')}
      </button>
    </>
  );
}
