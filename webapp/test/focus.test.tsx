import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { useFocusRescue } from '@/ui/focus-rescue';
import { Sheet } from '@/ui/Sheet';
import { translate } from './translations';

function Swapping() {
  useFocusRescue();
  const [paused, setPaused] = useState(false);
  return (
    <section>
      {paused ? (
        <button type="button" onClick={() => setPaused(false)}>
          Start
        </button>
      ) : (
        <button type="button" onClick={() => setPaused(true)}>
          Pause
        </button>
      )}
    </section>
  );
}

/** A screen reader whose focus falls to the body starts again from the top of the page. */
describe('the focus of a control that goes away', () => {
  it('lands on the control that took its place', async () => {
    render(
      <MemoryRouter>
        <Swapping />
      </MemoryRouter>,
    );
    const pause = screen.getByRole('button', { name: 'Pause' });
    pause.focus();
    fireEvent.click(pause);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toHaveFocus());
  });
});

describe('a sheet', () => {
  // The sheet names its close button from the catalogue.
  beforeAll(() => translate());

  it('makes the page behind it unreachable while it is open, and gives it back as it closes', () => {
    function Page() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <p>The page</p>
          <div>
            {open ? (
              <Sheet title="Question" onClose={() => setOpen(false)}>
                <p>Inside</p>
              </Sheet>
            ) : null}
          </div>
        </>
      );
    }
    render(<Page />);

    expect(screen.getByText('The page')).toHaveAttribute('inert');
    expect(screen.getByText('Inside').closest('[inert]')).toBeNull();

    act(() => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect(screen.getByText('The page')).not.toHaveAttribute('inert');
  });

  /** A page with one button, which opens a sheet with one field in it. */
  function Asking() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Ask
        </button>
        {open ? (
          <Sheet title="Question" note="for the whole tent" onClose={() => setOpen(false)}>
            <input aria-label="Answer" />
          </Sheet>
        ) : null}
      </>
    );
  }

  const ask = () => {
    render(<Asking />);
    const opener = screen.getByRole('button', { name: 'Ask' });
    opener.focus();
    fireEvent.click(opener);
    const sheet = screen.getByRole('dialog', { name: 'Question' });
    return { opener, sheet, backdrop: sheet.parentElement!, handle: sheet.firstElementChild as HTMLElement };
  };

  it('closes on a tap beside it, and gives the focus back to what opened it', () => {
    const { opener, backdrop } = ask();

    fireEvent.pointerDown(backdrop);
    // What a browser does with a press on something that takes no focus.
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.click(backdrop);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('stays open where a press that began inside it is let go beside it', () => {
    const { backdrop } = ask();

    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Answer' }));
    fireEvent.click(backdrop);

    expect(screen.getByRole('dialog', { name: 'Question' })).toBeInTheDocument();
  });

  it('follows its handle down, springs back from a short pull and is put away by a long one', () => {
    const { sheet, handle } = ask();

    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerMove(handle, { clientY: 140 });
    expect(sheet.style.transform).toBe('translateY(40px)');
    fireEvent.pointerUp(handle, { clientY: 140 });
    expect(sheet.style.transform).toBe('');
    expect(screen.getByRole('dialog', { name: 'Question' })).toBeInTheDocument();

    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerMove(handle, { clientY: 260 });
    fireEvent.pointerUp(handle, { clientY: 260 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks the page as held still behind it, and says under its title what its answer is for', () => {
    const { sheet, backdrop } = ask();

    // global.css stops the page scrolling while an element so marked is on it.
    expect(backdrop).toHaveAttribute('data-scrim');
    expect(sheet).toHaveAccessibleName('Question');
    expect(sheet).toHaveTextContent('for the whole tent');
  });
});
