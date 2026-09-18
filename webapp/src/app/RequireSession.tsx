import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { session, useSession } from '@/api/session';

/**
 * Nothing is decided until the stored refresh token has been tried, or a reload
 * would bounce a signed-in person to the sign-in page for a frame.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { user, restored } = useSession();
  const location = useLocation();

  useEffect(() => {
    void session.restore();
  }, []);

  if (!restored) return null;
  if (!user) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return children;
}
