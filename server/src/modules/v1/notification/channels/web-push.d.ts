/**
 * The little of `web-push` this server uses. The package ships no types of its
 * own and the published ones are a dependency for four lines of surface, so the
 * surface is stated here instead - and stating it is also what keeps the use of
 * the library to the one call that encrypts and signs, which is the only part
 * of Web Push worth not writing by hand.
 */
declare module 'web-push' {
  export interface PushTarget {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  export interface VapidDetails {
    subject: string;
    publicKey: string;
    privateKey: string;
  }

  /** Rejects with an error carrying `statusCode`, which is how a subscription that is over says so. */
  export function sendNotification(subscription: PushTarget, payload: string, options: { vapidDetails: VapidDetails }): Promise<unknown>;
}
