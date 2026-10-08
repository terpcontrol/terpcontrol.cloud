/** Everything under it answers RFC 7807; everything beside it is the Angular app's API. */
export const V1_PREFIX = '/v1';

/**
 * A request's path compared the way the router matches it, which ignores case:
 * `/V1/devices` reaches the same handler as `/v1/devices`, so a check that read
 * the path as written would be a way around it.
 */
export const routePath = (url: string | undefined): string => (url ?? '').split('?')[0].toLowerCase();

/** The prefix itself or anything below it, but not a sibling that merely starts with the same letters. */
export const isUnder = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

export const isV1Path = (url: string | undefined): boolean => isUnder(routePath(url), V1_PREFIX);
