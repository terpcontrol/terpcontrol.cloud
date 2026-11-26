import type { NotificationCategory } from '@fg2/shared-types/v1';
import { useShape } from '@/app/shell/shape';
import { callingRows } from './reach';

/** The rows of the grid something on this account can raise, read off what it has: devices, cameras, a diary. */
export const useCallingRows = (): NotificationCategory[] => {
  const { steering, cameras, diary } = useShape();
  return callingRows({ steering, cameras: cameras > 0, diary });
};
