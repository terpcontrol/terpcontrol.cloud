import { ChevronLeft } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import ui from './ui.module.css';

/** What the arrow tells the page it leads up to: the entry before it is a page under it, not the way the reader came. */
const LED_UP = { ledUp: true } as const;

/** Whether an entry of the app lies before the one on screen: the router numbers its entries from the one the document was loaded on. */
const reachedInside = (): boolean => {
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index === 'number' && index > 0;
};

/**
 * The chevron in the head of a page reached from another. Reached inside the
 * app it steps back - onto the entry the reader came from, as it was left, and
 * adds none, so the browser's Back and the arrow agree. Opened by its address
 * it leads to `to`, the page this one stands under, and so does that page's
 * arrow in turn. It is named by what it does.
 */
export function BackLink({ to, label, className }: { to: string; label: string; className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Asked of every entry for itself: the head is drawn again on each.
  const ledUp = (useLocation().state as { ledUp?: unknown } | null)?.ledUp === true;
  const steps = reachedInside() && !ledUp;

  const back = (event: MouseEvent) => {
    // A click that opens the link elsewhere - a new tab, a window - is the browser's.
    if (!steps || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void navigate(-1);
  };

  return (
    <Link
      to={to}
      state={LED_UP}
      className={className ? `${ui.back} ${className}` : ui.back}
      aria-label={steps ? t('device.back') : label}
      onClick={back}
    >
      <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
    </Link>
  );
}
