import { useEffect, useRef, useState } from 'react';

/**
 * Whether the folded section an item stands in has been opened, for an item
 * whose read costs something: a section is drawn on every visit to its page,
 * and what nobody unfolds should cost the server nothing. Once opened it stays
 * read. An item drawn outside a section is open from the start.
 */
export const useUnfolded = <E extends HTMLElement>() => {
  const ref = useRef<E>(null);
  const [unfolded, setUnfolded] = useState(false);

  useEffect(() => {
    const section = ref.current?.closest('details');
    if (!section || section.open) {
      setUnfolded(true);
      return;
    }

    const toggled = () => {
      if (section.open) setUnfolded(true);
    };
    section.addEventListener('toggle', toggled);
    return () => section.removeEventListener('toggle', toggled);
  }, []);

  return { ref, unfolded };
};
