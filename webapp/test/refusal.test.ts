import i18next from 'i18next';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@/api/problem';
import { refusalText } from '@/ui/refusal';
import { translate } from './translations';

/** A refusal is said in the reader's language, not in the English the server writes. */
const refused = (status: number, code: string, detail: string, title = 'Refused') => new ApiError({ status, code, title, detail, errors: [] });

beforeAll(() => translate(['en', 'de']));

afterEach(async () => {
  await i18next.changeLanguage('en');
});

describe('a refusal', () => {
  it("keeps the server's own sentence for an English reader", () => {
    expect(refusalText(refused(404, 'space_not_found', 'There is no space with that id.'))).toBe('There is no space with that id.');
  });

  it('words a known code from the catalogue in German', async () => {
    await i18next.changeLanguage('de');
    expect(refusalText(refused(404, 'space_not_found', 'There is no space with that id.'))).toBe(
      'Diesen Ort gibt es nicht mehr, oder du darfst ihn nicht sehen.',
    );
  });

  it('falls back to what kind of answer it was where the code is not known', async () => {
    await i18next.changeLanguage('de');
    expect(refusalText(refused(403, 'something_new', 'You may not manage that space.'))).toBe('Das darfst du hier nicht.');
  });

  it('never prints a bare server fault, in any language', () => {
    expect(refusalText(refused(500, 'internal', '', 'Internal Server Error'))).toBe('The server ran into a fault. Please try again.');
  });

  it("says a request that reached nothing as that, or as the caller's own words", () => {
    expect(refusalText(new TypeError('Failed to fetch'))).toBe(i18next.t('shell.unreachable'));
    expect(refusalText(new TypeError('Failed to fetch'), 'Could not ask')).toBe('Could not ask');
  });
});
