import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RouteError } from '@/app/RouteError';

/**
 * What a screen that throws leaves behind.
 *
 * The chart component is the one that really did this: an axis corner a
 * hairsbreadth off a round number threw out of ECharts, and with no boundary
 * anywhere the whole application became React Router's developer page - a bare
 * stack over the sentence "Hey developer, you can provide a way better UX than
 * this". So what is asserted here is the swap: the app's own words, no stack,
 * and a way on that is not the browser's back button.
 */

const Throws = () => {
  throw new Error('[ECharts] assert failed: extent[0] <= cfg.niceExtent[0]');
};

const drawWithBoundary = () =>
  render(
    <RouterProvider
      router={createMemoryRouter([{ errorElement: <RouteError />, children: [{ path: '/', element: <Throws /> }] }], { initialEntries: ['/'] })}
    />,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a screen that threw', () => {
  it('is replaced by the app´s own sentence and a way on, rather than by a stack trace', () => {
    // React writes the error it caught to the console itself, which is noise
    // here and is exactly where the boundary puts it as well.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    drawWithBoundary();

    expect(screen.getByRole('heading', { name: 'This screen could not be drawn' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing that was measured or written down is affected');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: 'Try it again' })).toBeInTheDocument();

    // Nothing of the exception itself reaches the screen, and all of it reaches
    // the console, where whoever is working on the chart will want it.
    expect(screen.queryByText(/niceExtent/)).not.toBeInTheDocument();
    expect(logged.mock.calls.flat().some(one => one instanceof Error && one.message.includes('niceExtent'))).toBe(true);
  });
});
