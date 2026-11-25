import { useEffect, useState } from 'react';

/**
 * The feedback form of whatever widget the install's `CUSTOM_SCRIPT_TAG` loads - on terpcontrol.cloud that is
 * BugDrop, which turns a report into an issue on GitHub. Its own floating button is switched off there
 * (`data-button="false"`) because it sat on top of the tab bar and the sheets' buttons; the app offers the form from
 * a button beside the alerts bell instead (top bar and rail), and only where the widget is actually loaded, so an
 * install without one shows no button that does nothing.
 *
 * The widget is a plain script that may finish after React has drawn, which is why the hook also waits for the
 * `bugdrop:ready` event: it is dispatched on `window` and does not bubble, so a listener on `document` never hears it.
 */
type FeedbackWidget = { open: () => void };

declare global {
  interface Window {
    BugDrop?: FeedbackWidget;
  }
}

/** Opens the feedback form, or null where no widget is loaded. */
export function useFeedback(): (() => void) | null {
  const [widget, setWidget] = useState<FeedbackWidget | null>(() => window.BugDrop ?? null);

  useEffect(() => {
    if (widget) return;
    const ready = () => setWidget(window.BugDrop ?? null);
    window.addEventListener('bugdrop:ready', ready);
    return () => window.removeEventListener('bugdrop:ready', ready);
  }, [widget]);

  return widget ? () => widget.open() : null;
}
