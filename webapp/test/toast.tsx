import type { ComponentProps, ReactNode } from 'react';
import { LogContext, type Told } from '@/log/log-context';

/**
 * The toast, for a screen that answers a write through it (`tell`): what it
 * was told lands in `told`, each line with the way it is taken back. Nothing
 * else of the entry sheet is there - a screen that opens it is drawn with the
 * provider itself.
 */
export function Toast({ told = [], children }: { told?: Told[]; children: ReactNode }) {
  const log = { tell: (one: Told) => told.push(one) } as unknown as ComponentProps<typeof LogContext>['value'];

  return <LogContext value={log}>{children}</LogContext>;
}
