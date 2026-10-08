/**
 * Hands a file the app already holds to the browser to save rather than open.
 * The link stands in the page for its click, and the object URL is released on
 * the next tick, once the browser has taken it.
 */
export const saveFile = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
