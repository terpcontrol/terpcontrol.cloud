/**
 * A request path as it may be written down.
 *
 * The query string goes: a picture URL carries the long-lived image token in
 * it. So does the secret in `/mqttauth/<secret>/...`, which the broker puts in
 * the path itself - and it checks credentials often enough to fill a log with
 * copies of it. The logs are kept for a month.
 */
const MQTT_AUTH_SECRET = /^\/(mqttauth)\/[^/]+/i;

export const loggablePath = (url: string | undefined): string => (url ?? '').split('?')[0].replace(MQTT_AUTH_SECRET, '/$1/<secret>');
