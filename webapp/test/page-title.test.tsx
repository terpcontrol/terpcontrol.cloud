import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { usePageTitle } from '@/app/shell/page-title';

function Shell() {
  const main = useRef<HTMLElement>(null);
  usePageTitle(main);
  return (
    <>
      <nav>
        <Link to="/tent">Tent</Link>
      </nav>
      <main ref={main}>
        <Routes>
          <Route path="/" element={<h1>Home</h1>} />
          <Route path="/tent" element={<h1>Blue Dream tent</h1>} />
        </Routes>
      </main>
    </>
  );
}

/** A screen reader announces the page by its title and is lost on the body once the link it pressed is gone. */
describe('the page a screen reader arrives on', () => {
  it('is named after its heading, and the heading takes the focus after a navigation but not on the first page', async () => {
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>,
    );
    expect(document.title).toBe('Home – Terp Control');
    expect(screen.getByRole('heading', { name: 'Home' })).not.toHaveFocus();

    await act(async () => screen.getByRole('link', { name: 'Tent' }).click());
    expect(document.title).toBe('Blue Dream tent – Terp Control');
    expect(screen.getByRole('heading', { name: 'Blue Dream tent' })).toHaveFocus();
  });
});
