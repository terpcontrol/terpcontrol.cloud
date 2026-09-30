/**
 * cloudSettings.rtspStream marker for a Terp Cam (`terpcam://<did>`). Using the
 * existing rtspStream field means the whole image pipeline — poll scheduling,
 * backoff, maintenance gating, the test-image button, storage, timelapses and
 * thinning — works for these cameras with no parallel machinery.
 */
export const TERPCAM_STREAM_PREFIX = 'terpcam://';

/** What cameras paired before the rename stored. Still read, never written. */
const LEGACY_STREAM_PREFIX = 'okam://';

/** Every prefix a stored stream may carry, newest first. */
export const TERPCAM_STREAM_PREFIXES = [TERPCAM_STREAM_PREFIX, LEGACY_STREAM_PREFIX];

/** The camera's label, or null when this is not a Terp Cam stream at all. */
export function terpCamLabel(stream?: string): string | null {
  const prefix = stream ? TERPCAM_STREAM_PREFIXES.find(p => stream.startsWith(p)) : undefined;
  return prefix && stream ? stream.slice(prefix.length) : null;
}
