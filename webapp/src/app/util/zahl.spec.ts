import { pluralSchluessel, zahlText } from './zahl';

describe('numbers, in the reader’s language', () => {
  it('writes a German decimal comma and an English decimal point', () => {
    expect(zahlText(2.5, 2, 'de-DE')).toBe('2,5');
    expect(zahlText(2.5, 2, 'en-US')).toBe('2.5');
  });

  it('groups thousands the way the language does', () => {
    expect(zahlText(1500, 0, 'de-DE')).toBe('1.500');
    expect(zahlText(1500, 0, 'en-US')).toBe('1,500');
  });

  it('drops trailing zeroes rather than inventing precision', () => {
    expect(zahlText(2, 2, 'de-DE')).toBe('2');
    expect(zahlText(6.15, 1, 'de-DE')).toBe('6,2');
  });
});

describe('plurals', () => {
  it('picks the singular for one and the plural for everything else', () => {
    expect(pluralSchluessel('zelt.kopf.eintraege', 1, 'de-DE')).toBe('zelt.kopf.eintraege.one');
    expect(pluralSchluessel('zelt.kopf.eintraege', 0, 'de-DE')).toBe('zelt.kopf.eintraege.other');
    expect(pluralSchluessel('zelt.kopf.eintraege', 14, 'de-DE')).toBe('zelt.kopf.eintraege.other');
  });

  it('counts the same way in English', () => {
    expect(pluralSchluessel('zelt.mehrZeilen', 1, 'en-US')).toBe('zelt.mehrZeilen.one');
    expect(pluralSchluessel('zelt.mehrZeilen', 3, 'en-US')).toBe('zelt.mehrZeilen.other');
  });
});
