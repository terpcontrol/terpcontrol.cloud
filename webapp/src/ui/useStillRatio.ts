import { type SyntheticEvent, useState } from 'react';

/**
 * A picture's shape once it has loaded (width / height), for the `<img>`'s
 * `onLoad`: null until then, and again as soon as another picture is shown.
 */
export function useStillRatio(src: string | null | undefined): [number | null, (event: SyntheticEvent<HTMLImageElement>) => void] {
  const [seen, setSeen] = useState<{ src: string; ratio: number } | null>(null);
  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight, currentSrc } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) setSeen({ src: src ?? currentSrc, ratio: naturalWidth / naturalHeight });
  };
  return [seen && seen.src === src ? seen.ratio : null, onLoad];
}
