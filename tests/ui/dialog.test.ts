// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { showDialog } from '../../src/ui/dialog';

const buttons = [
  { id: 'cancel', label: 'Cancel' },
  { id: 'delete', label: 'Delete', danger: true },
];

afterEach(() => {
  document.body.innerHTML = '';
});

function btn(label: string): HTMLButtonElement {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === label);
  if (!b) throw new Error('no button ' + label);
  return b as HTMLButtonElement;
}

describe('showDialog', () => {
  it('resolves with clicked button id', async () => {
    const p = showDialog({ message: 'Sure?', buttons, cancelId: 'cancel' });
    btn('Delete').click();
    expect(await p).toBe('delete');
  });

  it('Escape resolves cancelId', async () => {
    const p = showDialog({ message: 'Sure?', buttons, cancelId: 'cancel' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await p).toBe('cancel');
  });

  it('backdrop click resolves cancelId', async () => {
    const p = showDialog({ message: 'Sure?', buttons, cancelId: 'cancel' });
    (document.querySelector('.dialog-backdrop') as HTMLElement).click();
    expect(await p).toBe('cancel');
  });

  it('removes itself from the DOM after resolving', async () => {
    const p = showDialog({ message: 'Sure?', buttons, cancelId: 'cancel' });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    btn('Cancel').click();
    await p;
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('.dialog-backdrop')).toBeNull();
  });

  it('renders buttons in order with labels', async () => {
    const p = showDialog({ message: 'Sure?', buttons, cancelId: 'cancel' });
    const labels = [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent);
    expect(labels).toEqual(['Cancel', 'Delete']);
    expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-modal')).toBe('true');
    expect(btn('Delete').classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(btn('Cancel'));
    btn('Cancel').click();
    await p;
  });

  it('restores focus to the previously focused element', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const p = showDialog({ message: 'Sure?', buttons, cancelId: 'cancel' });
    btn('Delete').click();
    await p;
    expect(document.activeElement).toBe(opener);
  });

  it('a second dialog cancels the first, leaving one in the DOM', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const first = showDialog({ message: 'One', buttons, cancelId: 'cancel' });
    const second = showDialog({ message: 'Two', buttons: [{ id: 'ok', label: 'OK' }], cancelId: 'esc' });
    expect(await first).toBe('cancel');
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(document.querySelector('.dialog-message')!.textContent).toBe('Two');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await second).toBe('esc');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
