import { useSyncExternalStore } from 'react';

/**
 * The app on the home screen.
 *
 * Chromium hands a page that may be installed a `beforeinstallprompt` event
 * once, early, and it is only good for later if it is kept: the page that wants
 * to offer the install opens long after it fired. So it is caught as the app
 * starts and held here, and replayed when somebody taps the button. Safari has
 * no such event at all, which is why an iPhone is shown the steps instead - and
 * it matters there more than anywhere, because Safari delivers web push only to
 * an app that was added to the home screen.
 */

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  /** What the browser offered, held until it is used or the app is installed. */
  prompt: InstallPrompt | null;
  installed: boolean;
}

let state: InstallState = { prompt: null, installed: false };
const listeners = new Set<() => void>();

const publish = (next: InstallState) => {
  state = next;
  for (const listener of listeners) listener();
};

/** Called once as the app starts, before the browser's one chance to offer has passed. */
export const catchInstallPrompt = (): void => {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    publish({ ...state, prompt: event as InstallPrompt });
  });
  window.addEventListener('appinstalled', () => publish({ prompt: null, installed: true }));
};

/** Running from the home screen already, where there is nothing to install. */
export const isStandalone = (): boolean =>
  typeof window !== 'undefined' &&
  ((typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** An iPhone or an iPad - which since iPadOS 13 calls itself a Mac with a touch screen. */
export const isIos = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export interface Install {
  /** Installed, or opened from the home screen. */
  standalone: boolean;
  ios: boolean;
  /** The browser offered its own dialog, so one tap installs. */
  canPrompt: boolean;
  /** Shows that dialog; whatever the answer, the browser has dealt with it. */
  prompt: () => Promise<void>;
}

export const useInstall = (): Install => {
  const current = useSyncExternalStore(subscribe, () => state);

  return {
    standalone: current.installed || isStandalone(),
    ios: isIos(),
    canPrompt: current.prompt !== null,
    prompt: async () => {
      const offered = current.prompt;
      if (!offered) return;
      await offered.prompt();
      const choice = await offered.userChoice;
      // A dialog that was turned down cannot be shown again; one that was
      // accepted is followed by `appinstalled`.
      publish({ ...state, prompt: null, installed: state.installed || choice.outcome === 'accepted' });
    },
  };
};
