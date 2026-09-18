import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, useTheme } from '@/theme/theme-context';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * The theme follows the system until somebody overrules it, and the choice is
 * one attribute on <html> that survives a reload.
 */
describe('the theme', () => {
  let state: ReturnType<typeof useTheme> | null = null;
  const Probe = () => {
    state = useTheme();
    return null;
  };

  afterEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
  });

  it('follows the system by default, which is no attribute at all', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(state?.choice).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('writes the manual choice on <html> and remembers it', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => state?.setChoice('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    act(() => state?.setChoice('system'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('starts from what was remembered', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(state?.choice).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
