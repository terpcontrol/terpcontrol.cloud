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

/**
 * The same lines read back out of what was stored. The map is taken as
 * possibly absent although the contract declares it required, because what the
 * screen is handed is whatever the server answers and an answer is not a
 * promise: a webhook saved with no headers of its own was stored without the
 * key at all, and reading it as nothing rather than as an empty map is what
 * cost the account its whole notification screen - the channels, the routing
 * grid and quiet hours are drawn together, so the one absent key also took
 * away the only switch that could have turned the webhook back off. No shape a
 * row can have is worth that, so an absent map is the empty one here.
 */
export const headersText = (headers: Record<string, string> | null | undefined): string =>
  Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
