import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { writeStored } from '@/ui/stored';
import { THEME_STORAGE_KEY, ThemeContext, storedThemeChoice, type ThemeChoice } from './theme-context';

/**
 * The theme follows the system and a toggle overrules it. The choice is one
 * attribute on <html>, which `tokens.css` reads - no component re-renders and
 * no colour is decided in JavaScript.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(storedThemeChoice);

  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    writeStored(THEME_STORAGE_KEY, next === 'system' ? null : next);
  }, []);

  return <ThemeContext value={{ choice, setChoice }}>{children}</ThemeContext>;
}
