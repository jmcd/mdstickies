export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

type Mods = Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>;

/** Shift everywhere; Cmd on Mac, Ctrl elsewhere. Mac Ctrl-click is a context menu, not a select. */
export function isSelectModifier(e: Mods, mac = IS_MAC): boolean {
  return e.shiftKey || (mac ? e.metaKey : e.ctrlKey);
}

export function isPrimaryShortcut(e: Mods, mac = IS_MAC): boolean {
  return mac ? e.metaKey : e.ctrlKey;
}
