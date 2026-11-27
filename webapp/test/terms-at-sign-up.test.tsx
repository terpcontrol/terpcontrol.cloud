import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '@/api/session';
import { SignUp } from '@/screens/SignUp';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { drawAt, json } from './harness';
import { translate } from './translations';

/**
 * An install that publishes terms of use has them accepted, with being of age,
 * before an account is made, and says so to the server, which records it. The
 * privacy statement beside it is linked as information and asks nothing.
 */

vi.mock('@/api/config', async importOriginal => ({
  ...(await importOriginal<object>()),
  PRIVACY_URL: 'https://example.test/privacy.html',
  TERMS_URL: 'https://example.test/terms?stand=2026-11',
}));

const wrote: string[] = [];
const bodies: unknown[] = [];
let refusal: unknown = null;

beforeAll(() => translate());

beforeEach(() => {
  wrote.length = 0;
  bodies.length = 0;
  refusal = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      wrote.push(`${init?.method ?? 'GET'} ${String(input).replace(/^.*\/v1/, '')}`);
      bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      if (refusal) return json(refusal, 422);
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
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newbie' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long enough secret' } });
};

describe('the terms of use at sign-up', () => {
  it('links them and refuses to ask for an account until they are accepted, then says they were', async () => {
    draw();
    expect(screen.getByRole('link', { name: 'terms of use' })).toHaveAttribute('href', 'https://example.test/terms?stand=2026-11');

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create the account' }));
    expect(await screen.findByText('Please confirm that you are at least 18 and accept the terms of use.')).toBeInTheDocument();
    expect(wrote).toEqual([]);

    fireEvent.click(screen.getByRole('checkbox', { name: /I am at least 18 years old and accept the/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create the account' }));
    expect(await screen.findByLabelText('Activation code')).toBeInTheDocument();
    expect(wrote).toEqual(['POST /users']);
    expect(bodies[0]).toMatchObject({ acceptTerms: true });
  });

  it('links the privacy statement as information, with no box of its own', () => {
    draw();

    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', 'https://example.test/privacy.html');
    expect(screen.getByText(/How we handle your data is described in the/)).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('says what the server refused at the field it refused, in the catalogue´s words', async () => {
    refusal = {
      status: 422,
      code: 'password_too_short',
      title: 'Unprocessable',
      detail: 'A new password needs at least 8 characters.',
      errors: [{ field: 'password', code: 'too_small', detail: 'A new password needs at least 8 characters.' }],
    };
    draw();
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();

    fill();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create the account' }));

    expect(await screen.findByText('A new password needs at least 8 characters.')).toBeInTheDocument();
    // Said once, at the field, and not again in the alert under the form.
    expect(screen.getByRole('alert')).toHaveTextContent(/^$/);
  });
});
