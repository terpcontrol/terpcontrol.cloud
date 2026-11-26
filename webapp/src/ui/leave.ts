import { useState } from 'react';
import { useNavigate } from 'react-router';
import { session } from '@/api/session';

/** Ends the session, then opens `to`: a session that exists is sent straight back off the sign-in pages, so it goes first. */
export const useLeave = (to: string) => {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const leave = async () => {
    setLeaving(true);
    await session.logOut();
    await navigate(to, { replace: true });
  };

  return { leaving, leave };
};
