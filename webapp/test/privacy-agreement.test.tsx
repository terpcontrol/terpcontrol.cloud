import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '@/api/session';
import { SignUp } from '@/screens/SignUp';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { drawAt, json } from './harness';
import { translate } from './translations';

/**
 * An install that publishes a privacy statement has it agreed to before an
 * account is made: the box links to it, and an account is not asked for
 * while it is empty.
 */

vi.mock('@/api/config', async importOriginal => ({ ...(await importOriginal<object>()), PRIVACY_URL: 'https://example.test/privacy.html' }));

const wrote: string[] = [];

beforeAll(() => translate());

beforeEach(() => {
  wrote.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      wrote.push(`${init?.method ?? 'GET'} ${String(input).replace(/^.*\/v1/, '')}`);
      return json({ id: 'u', createdAt: '2026-01-01T00:00:00Z', email: 'a@b.c', handle: 'a', isActive: false }, 201);
    }),
  );
});

afterEach(async () => {
  await session.logOut();
  vi.unstubAllGlobals();
});

const draw = () =>
  drawAt(
    <ThemeProvider>
      <Routes>
        <Route path="/sign-up" element={<SignUp />} />
      </Routes>
    </ThemeProvider>,
    { at: '/sign-up' },
  );

const fill = () => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newbie' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long enough secret' } });
};

describe('the privacy statement at sign-up', () => {
  it('links to the statement and refuses to ask for an account until it is accepted', async () => {
    draw();
    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', 'https://example.test/privacy.html');

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create the account' }));
    expect(await screen.findByText('Please accept the privacy policy to create an account.')).toBeInTheDocument();
    expect(wrote).toEqual([]);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create the account' }));
    expect(await screen.findByLabelText('Activation code')).toBeInTheDocument();
    expect(wrote).toEqual(['POST /users']);
  });
});
