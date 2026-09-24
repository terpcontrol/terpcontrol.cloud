import { act, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Sheet } from '@/log/Sheet';
import { Help, Term } from '@/ui/Help';
import { anchorOf, HELP_TOPICS, placeBubble } from '@/ui/explain';

/**
 * What the app's explanations promise: that one opens on a tap, a click or the
 * keyboard's arrival alike, because a phone has no hover; that Escape and a
 * press anywhere else put it away, and Escape inside a sheet takes back the
 * explanation and not the sheet; that a screen reader is read the explanation
 * without opening anything; and that every topic is written in both languages.
 */

const catalogue = async (language: string) =>
  JSON.parse(await readFile(resolve(process.cwd(), `public/assets/i18n/${language}.json`), 'utf8')) as Record<string, unknown>;

beforeAll(async () => {
  const [en, de] = await Promise.all([catalogue('en'), catalogue('de')]);
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en }, de: { translation: de } },
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });
});

const TITLE = () => i18next.t('help.vpd.title');
const TEXT = () => i18next.t('help.vpd.text');
const info = () => screen.getByRole('button', { name: i18next.t('help.about', { title: TITLE() }) });

describe('the (i) beside a control', () => {
  it('is a button named after what it explains, with the explanation as its description before anything is opened', () => {
    render(<Help topic="vpd" />);

    expect(info()).toHaveAttribute('aria-expanded', 'false');
    expect(info()).toHaveAccessibleDescription(TEXT());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on a click or a tap and closes on the next one', () => {
    render(<Help topic="vpd" />);

    // A press focuses the button in most browsers before the click arrives; the click decides.
    fireEvent.pointerDown(info());
    fireEvent.focus(info());
    fireEvent.click(info());

    const bubble = screen.getByRole('tooltip');
    expect(bubble).toHaveTextContent(TITLE());
    expect(bubble).toHaveTextContent(TEXT());
    expect(info()).toHaveAttribute('aria-expanded', 'true');
    expect(info()).toHaveAttribute('aria-controls', bubble.id);

    fireEvent.pointerDown(info());
    fireEvent.click(info());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(info()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on a touch that never focuses the button, as a phone taps', () => {
    render(<Help topic="vpd" />);

    fireEvent.pointerDown(info(), { pointerType: 'touch' });
    fireEvent.click(info());

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('opens when the keyboard reaches it, toggles on Enter, and goes when the focus moves on', () => {
    render(
      <>
        <Help topic="vpd" />
        <button type="button">next</button>
      </>,
    );

    act(() => info().focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    // Enter and Space arrive at a button as a click.
    fireEvent.click(info());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(info());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => screen.getByRole('button', { name: 'next' }).focus());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes on Escape and keeps the focus where it was', () => {
    render(<Help topic="vpd" />);

    act(() => info().focus());
    fireEvent.keyDown(info(), { key: 'Escape' });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(info()).toHaveFocus();
  });

  it('closes on a press anywhere else, and stays open for a press inside it', () => {
    render(
      <>
        <Help topic="vpd" />
        <p>elsewhere</p>
      </>,
    );

    fireEvent.click(info());
    fireEvent.pointerDown(screen.getByRole('tooltip'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('is one at a time: opening a second puts the first away', () => {
    render(
      <>
        <Help topic="vpd" />
        <Term topic="vpd">VPD</Term>
      </>,
    );

    fireEvent.click(info());
    fireEvent.click(screen.getByRole('button', { name: 'VPD' }));

    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(info()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'VPD' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('inside a sheet, Escape takes back the explanation and leaves the sheet open', () => {
    const onClose = vi.fn();
    render(
      <Sheet title="Targets" onClose={onClose}>
        <Help topic="vpd" />
      </Sheet>,
    );

    fireEvent.click(info());
    fireEvent.keyDown(info(), { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // With nothing open, Escape is the sheet's again.
    fireEvent.keyDown(info(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not pass its click on to a row that opens on one', () => {
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <Help topic="vpd" />
      </div>,
    );

    fireEvent.click(info());
    fireEvent.click(screen.getByRole('tooltip'));

    expect(onRow).not.toHaveBeenCalled();
  });
});

describe('a term in running text', () => {
  it('is the word itself, a button that describes itself and opens the same explanation', () => {
    render(
      <p>
        Keep the <Term topic="vpd">VPD</Term> in range.
      </p>,
    );

    const term = screen.getByRole('button', { name: 'VPD' });
    expect(term).toHaveAccessibleDescription(TEXT());
    expect(term.closest('p')).toHaveTextContent('Keep the VPD in range.');

    fireEvent.click(term);
    expect(screen.getByRole('tooltip')).toHaveTextContent(TEXT());
  });
});

describe('where the bubble stands', () => {
  const PHONE = { width: 390, height: 844 };
  const size = { width: 358, height: 120 };

  it('goes above the line it explains when there is room, clear of it', () => {
    const anchor = { top: 400, bottom: 420, left: 300, right: 320 };
    const at = placeBubble(anchor, size, PHONE);

    expect(at.side).toBe('above');
    expect(at.top + size.height).toBeLessThanOrEqual(anchor.top);
  });

  it('goes below when the line is too near the top, still clear of it', () => {
    const anchor = { top: 70, bottom: 90, left: 300, right: 320 };
    const at = placeBubble(anchor, size, PHONE);

    expect(at.side).toBe('below');
    expect(at.top).toBeGreaterThanOrEqual(anchor.bottom);
  });

  it('keeps a phone gutter on both sides and points its arrow at the trigger', () => {
    const anchor = { top: 400, bottom: 420, left: 340, right: 360 };
    const at = placeBubble(anchor, size, PHONE);

    expect(at.left).toBeGreaterThanOrEqual(16);
    expect(at.left + size.width).toBeLessThanOrEqual(PHONE.width - 16);
    expect(at.left + at.arrow).toBe(350);
  });

  it('keeps clear of the whole sentence an (i) ends, but not of a whole panel', () => {
    const trigger = { top: 500, bottom: 520, left: 300, right: 320 };
    const sentence = { top: 440, bottom: 520, left: 16, right: 374 };
    const at = placeBubble(anchorOf(trigger, sentence), size, PHONE);

    expect(at.side).toBe('above');
    expect(at.top + size.height).toBeLessThanOrEqual(sentence.top);
    expect(anchorOf(trigger, { top: 100, bottom: 700, left: 16, right: 374 })).toEqual(trigger);
  });

  it('reads a measured rectangle, whose sides are not its own properties', () => {
    const measured = new DOMRect(300, 500, 20, 20);

    expect(anchorOf(measured, new DOMRect(16, 440, 358, 80))).toEqual({ top: 440, bottom: 520, left: 300, right: 320 });
  });

  it('takes the larger side and says how much room it has when neither side is enough', () => {
    const tall = { width: 358, height: 900 };
    const at = placeBubble({ top: 300, bottom: 320, left: 100, right: 120 }, tall, PHONE);

    expect(at.side).toBe('below');
    expect(at.room).toBeLessThan(tall.height);
  });
});

describe('the explanations', () => {
  it('are all written in both languages, and nothing is written that no topic opens', async () => {
    for (const language of ['en', 'de']) {
      const help = (await catalogue(language)).help as Record<string, unknown>;
      const { about, ...topics } = help;

      expect(typeof about, `${language}: help.about`).toBe('string');
      expect(Object.keys(topics).sort()).toEqual([...HELP_TOPICS].sort());
      for (const topic of HELP_TOPICS) {
        const entry = topics[topic] as { title?: unknown; text?: unknown };
        expect(typeof entry.title, `${language}: help.${topic}.title`).toBe('string');
        expect(typeof entry.text, `${language}: help.${topic}.text`).toBe('string');
        expect((entry.text as string).length, `${language}: help.${topic}.text`).toBeGreaterThan(20);
      }
    }
  });
});
