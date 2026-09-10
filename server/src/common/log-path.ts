/**
 * What may be written down.
 *
 * The logs are kept for a month, and several of the things the server handles
 * carry a credential in the middle of an otherwise ordinary string.
 */

// A picture URL carries the long-lived image token in its query string, and the
// secret in `/mqttauth/<secret>/...` travels in the path itself - the broker
// checks credentials often enough to fill a log with copies of it.
const MQTT_AUTH_SECRET = /^\/(mqttauth)\/[^/]+/i;

export const loggablePath = (url: string | undefined): string => (url ?? '').split('?')[0].replace(MQTT_AUTH_SECRET, '/$1/<secret>');

// A camera URL is `rtsp://user:password@host/stream`, which is how the webapp
// stores it, and an ffmpeg failure quotes the whole command line back.
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]*@/gi;

/** The same text with any `user:password@` in it replaced. */
export const withoutCredentials = (text: string): string => text.replace(URL_CREDENTIALS, '$1<credentials>@');
