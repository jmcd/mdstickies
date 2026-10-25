export function downloadFile(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function pickFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    const done = (): void => input.remove();
    input.addEventListener('change', () => {
      done();
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, reject);
    });
    // Not every browser fires `cancel`; where it doesn't, the promise simply stays pending.
    input.addEventListener('cancel', () => {
      done();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}
