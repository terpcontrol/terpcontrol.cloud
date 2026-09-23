import { useState, type ReactNode } from 'react';

/**
 * A picture in a frame that knows whether it has one.
 *
 * What a public page may draw and what it may fetch are two decisions, and a
 * link narrowed to a few days is where they part company: the answer still
 * names the diary's cover, and the route that serves the bytes refuses it
 * because it was taken outside the reader's window. A broken-image glyph is the
 * worst of both, so a picture that does not arrive leaves its frame empty and
 * the page reads as if there had never been one.
 */
export function Photo({
  src,
  alt,
  className,
  fallback = null,
}: {
  src: string | null;
  alt: string;
  className: string;
  /** What the frame holds instead: a leaf, a person's initials, or nothing at all. */
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const shown = src !== null && !failed;

  return (
    <span className={className} data-empty={!shown}>
      {shown ? <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} /> : fallback}
    </span>
  );
}
