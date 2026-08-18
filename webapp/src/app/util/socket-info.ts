/**
 * Shared parsing of the controller/fridge smart-socket hardware reports:
 * `hardwareInfo.sockets` is a csv of connected roles ("none" = definitively
 * empty, absent = firmware too old to report), `hardwareInfo.socket_ips`
 * carries "role@ip" pairs.
 */
export const SOCKET_ROLES = ['dehumidifier', 'heater', 'light', 'secondary_light', 'co2'] as const;

export function parseSocketRoles(csv: string | undefined): string[] {
  if (!csv || csv === 'none') {
    return [];
  }
  return csv.split(',').filter(role => role.length > 0);
}

export function socketIpFromCsv(csv: string | undefined, role: string): string | null {
  if (!csv || csv === 'none') {
    return null;
  }
  const entry = csv.split(',').find(pair => pair.startsWith(role + '@'));
  return entry ? entry.slice(role.length + 1) : null;
}
