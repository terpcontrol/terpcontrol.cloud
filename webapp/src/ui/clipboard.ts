/**
 * Putting an address on the clipboard, wherever it can be put.
 *
 * The clipboard API needs a secure context and permission, and a stack reached
 * over plain HTTP on a phone is neither - which is exactly where somebody is
 * most likely to be copying a link. So the old selection trick is kept as the
 * second attempt, and a caller is told which of the two happened so that a
 * button can say "copied" only when something was.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused or unavailable; the field below is still allowed.
  }

  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    // Off the page but still selectable, and fixed so that selecting it cannot scroll.
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  } catch {
    return false;
  }
};

/**
 * The address a person hands out, as this browser reached the app. It is not
 * the API's own `/g/{slug}`, which answers the small shell a chat window reads;
 * this is the one that opens the page.
 */
export const appUrl = (path: string): string => `${window.location.origin}${path}`;
