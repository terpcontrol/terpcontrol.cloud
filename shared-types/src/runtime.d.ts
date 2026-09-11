// Appended verbatim to the generated index.d.ts by scripts/generate.mjs.
//
// The runtime half of this package: index.js implements the smart-socket
// hardware report, and firmware, server and webapp all read that one format.
// These are values and functions rather than wire shapes, so they are declared
// here rather than derived from a schema.

export const SOCKET_ROLES: SocketRole[];
export const MAX_SOCKETS: number;
export const SOCKETS_PER_REPORT_CHUNK: number;
export function socketListKey(chunk: number): string;
export function socketListChunk(key: string): number | null;
export function socketChunkCount(count: number): number;
export function parseSocketRoles(csv: string | undefined): string[];
export function socketIpFromCsv(csv: string | undefined, role: string): string | null;
export function reportedSocketCount(hardwareInfo: Record<string, string> | undefined): number | null;
export function parseSocketList(hardwareInfo: Record<string, string> | undefined): SocketEntry[] | null;
export function socketsReported(hardwareInfo: Record<string, string> | undefined): boolean;
export function readSockets(hardwareInfo: Record<string, string> | undefined): SocketEntry[];
export function socketRoles(hardwareInfo: Record<string, string> | undefined): string[];
export function socketKey(socket: SocketEntry): string;
export function socketReportKey(hardwareInfo: Record<string, string> | undefined): string;
