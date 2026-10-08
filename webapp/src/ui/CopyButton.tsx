import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCopied } from './clipboard';
import ui from './ui.module.css';

/**
 * An address beside the one thing anybody does with it.
 *
 * The address is shown in full and stays selectable, because a browser that
 * refuses the clipboard leaves reading it off the screen as the only way - and
 * the button then says so rather than claiming a copy that did not happen.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [state, copy] = useCopied();

  return (
    <button type="button" className={ui.chip} aria-label={label} onClick={() => void copy(value)}>
      {state === 'copied' ? <Check size={13} strokeWidth={2} aria-hidden /> : <Copy size={13} strokeWidth={2} aria-hidden />}
      {t(state === 'copied' ? 'sharing.copied' : state === 'failed' ? 'sharing.copyFailed' : 'sharing.copy')}
    </button>
  );
}
