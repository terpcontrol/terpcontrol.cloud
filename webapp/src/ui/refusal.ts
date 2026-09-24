import i18next from 'i18next';
import { ApiError } from '@/api/problem';

/**
 * What a refusal says, in the reader's language.
 *
 * The server writes its refusals for a person, but only in English, so a
 * German page printed "There is no space with that id." or a bare "Internal
 * Server Error" under its own German controls. The sentence is kept where the
 * reader reads English, because it names the particular reason; elsewhere the
 * catalogue words the refusal by its code where it knows it, and by the kind
 * of answer where it does not. A server fault carries no sentence worth
 * showing in any language, so it is always said in the catalogue's words.
 *
 * Anything that is not a problem document never reached the server at all and
 * is said as that, or as the caller's own fallback where it has one.
 */
export const refusalText = (error: unknown, fallback?: string): string => {
  if (!(error instanceof ApiError)) return fallback ?? i18next.t('shell.unreachable');

  const { status, code, detail, title } = error.problem;
  const english = (i18next.language ?? 'en').startsWith('en');
  if (english && status < 500 && (detail || title)) return detail || title;

  const coded = `problem.code.${code}`;
  if (i18next.exists(coded)) return i18next.t(coded);

  return i18next.t(`problem.status.${statusKind(status)}`);
};

type StatusKind = 'invalid' | 'forbidden' | 'missing' | 'conflict' | 'tooMany' | 'fault';

const statusKind = (status: number): StatusKind => {
  if (status === 403 || status === 401) return 'forbidden';
  if (status === 404) return 'missing';
  if (status === 409) return 'conflict';
  if (status === 429) return 'tooMany';
  if (status >= 500) return 'fault';
  return 'invalid';
};
