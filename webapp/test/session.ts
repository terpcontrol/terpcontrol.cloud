import type { SessionState } from '@/api/session';

/**
 * Who is looking, for the screens that ask.
 *
 * Every screen under test lives behind the sign-in wall, so a test that renders
 * one has somebody signed in - and what a screen offers depends on which
 * somebody: the demo may read the whole account and write nothing to it, which
 * is why the Log button and every Done are not drawn for it.
 */
const state = (user: SessionState['user']): SessionState => ({ user, tokens: null, sessionId: 'session-1', restored: true });

export const SIGNED_IN = state({ id: 'user-1', handle: 'you', isAdmin: false, isDemo: false });

export const ON_THE_DEMO = state({ id: 'user-demo', handle: 'demo', isAdmin: false, isDemo: true });
