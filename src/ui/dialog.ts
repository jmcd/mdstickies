export interface DialogButton {
  id: string;
  label: string;
  danger?: boolean;
}

let active: { dismiss: () => void; previous: HTMLElement | null } | null = null;

export function showDialog(opts: {
  message: string;
  buttons: DialogButton[];
  cancelId: string;
}): Promise<string> {
  return new Promise((resolve) => {
    // Only one dialog at a time: cancel any open one, and keep the original focus target.
    const previous = active ? active.previous : (document.activeElement as HTMLElement | null);
    active?.dismiss();

    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const message = document.createElement('p');
    message.className = 'dialog-message';
    message.textContent = opts.message;

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';

    let done = false;
    const finish = (id: string): void => {
      if (done) return;
      done = true;
      active = null;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      previous?.focus();
      resolve(id);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(opts.cancelId);
      }
    };

    active = { dismiss: () => finish(opts.cancelId), previous };

    let first: HTMLButtonElement | null = null;
    for (const b of opts.buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.label;
      if (b.danger) el.classList.add('danger');
      else if (!first) first = el;
      el.addEventListener('click', () => finish(b.id));
      actions.append(el);
    }

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish(opts.cancelId);
    });
    document.addEventListener('keydown', onKey, true);

    dialog.append(message, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    (first ?? actions.querySelector('button'))?.focus();
  });
}
