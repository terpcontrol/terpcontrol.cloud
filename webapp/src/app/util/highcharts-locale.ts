import type * as HighchartsType from 'highcharts';

const monthNames = (locale: string, month: 'long' | 'short'): string[] => {
  const format = new Intl.DateTimeFormat(locale, { month, timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, index) => format.format(Date.UTC(2021, index, 15)));
};

const weekdayNames = (locale: string, weekday: 'long' | 'short'): string[] => {
  const format = new Intl.DateTimeFormat(locale, { weekday, timeZone: 'UTC' });
  // 2021-08-01 was a Sunday, which is where Highcharts' weekday list starts.
  return Array.from({ length: 7 }, (_, index) => format.format(Date.UTC(2021, 7, 1 + index)));
};

const separators = (locale: string): { decimalPoint: string; thousandsSep: string } => {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return {
    decimalPoint: parts.find(part => part.type === 'decimal')?.value ?? '.',
    thousandsSep: parts.find(part => part.type === 'group')?.value ?? ',',
  };
};

/**
 * Teaches Highcharts the app's language: month and weekday names for the time
 * axis, the local decimal separator, and a translated empty-chart notice. The
 * credit line is dropped — it is not part of this product's UI.
 */
export function applyHighchartsLocale(
  Highcharts: typeof HighchartsType,
  locale: string,
  texts: { noData: string; resetZoom: string; resetZoomTitle: string; loading: string },
) {
  Highcharts.setOptions({
    lang: {
      months: monthNames(locale, 'long'),
      shortMonths: monthNames(locale, 'short'),
      weekdays: weekdayNames(locale, 'long'),
      shortWeekdays: weekdayNames(locale, 'short'),
      ...separators(locale),
      noData: texts.noData,
      resetZoom: texts.resetZoom,
      resetZoomTitle: texts.resetZoomTitle,
      loading: texts.loading,
    },
    credits: { enabled: false },
  });
}
