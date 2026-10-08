import { AccessContext } from '@common/v1/access.types';

/** Who is asking, as the guards read it off a request. */
const caller = (over: Partial<AccessContext>): AccessContext => ({ userId: null, isAdmin: false, isDemo: false, shareToken: null, ...over });

export const anonymous = caller({});
export const session = (userId: string): AccessContext => caller({ userId });
export const visitor = (shareToken: string): AccessContext => caller({ shareToken });
export const admin = (userId = 'user-admin'): AccessContext => caller({ userId, isAdmin: true });
export const demo = (userId: string | null = 'user-demo'): AccessContext => caller({ userId, isDemo: true });
