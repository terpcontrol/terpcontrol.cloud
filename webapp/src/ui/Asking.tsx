import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ui from './ui.module.css';

/**
 * A step said before it is taken, in the place the tap was: what it will do,
 * anything it still needs (`children`), and the yes beside the way back. A
 * step that cannot be taken back answers yes in the alarm colour.
 */
export function Asking({
  note,
  yes,
  danger = false,
  busy,
  onYes,
  onCancel,
  children,
}: {
  note: ReactNode;
  yes: string;
  danger?: boolean;
  busy: boolean;
  onYes: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const question = useRef<HTMLParagraphElement>(null);

  // Asked because something was pressed, often in place of it: the question takes the focus, so it is what is read.
  useEffect(() => question.current?.focus({ preventScroll: true }), []);

  return (
    <div className={ui.asking}>
      <p className={ui.note} ref={question} tabIndex={-1}>
        {note}
      </p>
      {children}
      <div className={ui.askingActions}>
        <button type="button" className={`${ui.button} ${danger ? ui.dangerFilled : ui.primary}`} disabled={busy} onClick={onYes}>
          {yes}
        </button>
        <button type="button" className={ui.button} onClick={onCancel}>
          {t('asking.cancel')}
        </button>
      </div>
    </div>
  );
}
