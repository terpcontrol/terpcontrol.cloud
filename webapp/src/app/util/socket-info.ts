/**
 * The smart-socket hardware report. Its format is shared with the server (and
 * described in `@fg2/shared-types`), so the webapp only re-exports what it
 * reads - nothing here knows the individual hardware-info keys.
 */
export {
  MAX_SOCKETS,
  SOCKET_ROLES,
  readSockets,
  socketKey,
  socketReportKey,
  socketRoles,
  socketsReported,
} from '@fg2/shared-types';
export type { SocketEntry } from '@fg2/shared-types';
