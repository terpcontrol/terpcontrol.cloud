import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { useFocusRescue } from '@/ui/focus-rescue';
import { Sheet } from '@/ui/Sheet';

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
});
