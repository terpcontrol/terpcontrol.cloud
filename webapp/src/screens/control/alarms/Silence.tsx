import { useTranslation } from 'react-i18next';
import ui from '@/ui/ui.module.css';
import type { useSilence } from './use-silence';

/** "1 Std stumm", or "Wieder laut" on a rule that is silenced: the tap of `useSilence`, wherever a rule shows that it has raised. */
export function SilenceChip({ silence }: { silence: ReturnType<typeof useSilence> }) {
  const { t } = useTranslation();

  return (
    <button type="button" className={ui.chip} disabled={silence.busy} onClick={silence.toggle}>
      {t(silence.silenced ? 'alerts.action.unsilence' : 'alerts.action.silence')}
    </button>
  );
}
