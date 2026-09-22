import { useQuery } from '@tanstack/react-query';

/**
 * The browser's half of the push channel.
 *
 * Whether this browser is pushed to is not a fact of the account: it is a
 * subscription the browser's push service handed out, held by the service
 * worker, and the server only knows about it because the browser told it. So
 * the switch reads the browser and not `/me`, and the account's part - the row
 * the server keeps - is remembered here by the endpoint that identifies it, so
 * that switching off can name the row to remove.
 */

export const pushSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

/**
 * How long to wait for the service worker to take charge before deciding that
 * there is none. A build that ships no worker - the development server - would
 * otherwise hold the switch in "asking" forever.
 */
const WORKER_WAIT_MS = 5000;

const registration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!pushSupported()) return null;
  const none = new Promise<null>(resolve => setTimeout(() => resolve(null), WORKER_WAIT_MS));
  return Promise.race([navigator.serviceWorker.ready, none]);
};

export const currentSubscription = async (): Promise<PushSubscription | null> => {
  const worker = await registration();
  return worker ? worker.pushManager.getSubscription() : null;
};

export const pushKey = ['push-subscription'];

/** What the browser holds, read once per screen and again after every switch. */
export const usePushSubscription = () => useQuery({ queryKey: pushKey, queryFn: currentSubscription, staleTime: Infinity });

/** The VAPID key travels as base64url and the push manager wants the bytes. */
export const applicationServerKey = (base64url: string): Uint8Array => {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
};

/**
 * Asks the person, then the push service. `null` is the person saying no, and
 * a browser without a worker throws, which the card puts into words.
 */
export const subscribe = async (key: string): Promise<PushSubscription | null> => {
  if ((await Notification.requestPermission()) !== 'granted') return null;
  const worker = await registration();
  if (!worker) throw new Error('no service worker');
  return worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(key) as BufferSource });
};

const storageKey = (endpoint: string): string => `push-subscription:${endpoint}`;

export const rememberId = (endpoint: string, id: string): void => {
  try {
    localStorage.setItem(storageKey(endpoint), id);
  } catch {
    // Storage that is blocked costs the id, and switching off then leaves the server's row until it is pushed to and fails.
  }
};

export const rememberedId = (endpoint: string): string | null => {
  try {
    return localStorage.getItem(storageKey(endpoint));
  } catch {
    return null;
  }
};

export const forgetId = (endpoint: string): void => {
  try {
    localStorage.removeItem(storageKey(endpoint));
  } catch {
    // Nothing to forget where nothing could be kept.
  }
};
