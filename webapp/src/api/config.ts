/**
 * The API this build talks to. `scripts/set-env.mjs` writes it from the root
 * `.env` for a developer; the image build passes it as `VITE_API_URL`. The
 * fallback is the local stack, which is what a checkout without either has.
 */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || 'http://localhost:5081';

export const v1 = (path: string): string => `${API_URL}/v1${path}`;
