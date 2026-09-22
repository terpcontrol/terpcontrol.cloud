/**
 * A webhook's headers, edited as lines of "Name: value" because a person who
 * has one to set has copied it from somewhere that writes it that way. Both
 * the account's own webhook and an alarm rule's are edited this way, so the
 * reading and the writing live here rather than beside either screen. A line
 * with no colon, or with nothing before it, is not a header and is dropped
 * rather than sent as one.
 */
export const headersOf = (text: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    if (name) headers[name] = line.slice(at + 1).trim();
  }
  return headers;
};

export const headersText = (headers: Record<string, string>): string =>
  Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
