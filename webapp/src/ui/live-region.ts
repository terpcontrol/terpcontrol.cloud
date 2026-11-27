/**
 * One live region for the whole app, made once and never taken away.
 *
 * A region drawn together with its text is mostly not read - NVDA and JAWS
 * announce changes to a region they already know - and a region that takes
 * `role="status"` only once the answer is in is that. Whatever says
 * "Wartung läuft", "gesendet" or "Regelung aus" once it happened says it here.
 * It sits on the body, beside the app, so a sheet that makes the page behind
 * it inert leaves it heard (`modal-focus.ts` skips it).
 */
let region: HTMLElement | null = null;
let pending: number | undefined;

export const ANNOUNCER = 'data-announcer';

const regionOf = (): HTMLElement => {
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute(ANNOUNCER, '');
  // The same as `.visuallyHidden`, which a module class cannot reach from here.
  Object.assign(region.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  });
  document.body.append(region);
  return region;
};

/** Says `text` once. Emptied first, so the same words said twice are heard twice. */
export const announce = (text: string) => {
  const live = regionOf();
  live.textContent = '';
  window.clearTimeout(pending);
  pending = window.setTimeout(() => (live.textContent = text), 100);
};
