import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // A private window forgets the choice; the system's is a fine answer.
    }
  }, []);

  return <ThemeContext value={{ choice, setChoice }}>{children}</ThemeContext>;
}
