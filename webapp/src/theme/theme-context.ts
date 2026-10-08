import { createContext, use } from 'react';
import { readStored } from '@/ui/stored';

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'terp.theme';

interface ThemeState {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
}

export const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const state = use(ThemeContext);
  if (!state) throw new Error('useTheme outside ThemeProvider');
  return state;
}

export const storedThemeChoice = (): ThemeChoice => {
  const value = readStored(THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
};
