// Cross-platform keyboard conventions. On macOS ⌘ and Ctrl both work as the shortcut key;
// on Windows / Linux / ChromeOS it is Ctrl. Labels name the platform's usual key.

const ua = navigator.userAgent;
const platform =
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? ua;

export const isMac = /mac|iphone|ipad/i.test(platform);

/** True when a shortcut modifier is held: ⌘ or Ctrl on a Mac, Ctrl elsewhere. */
export function isMod(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.ctrlKey || (isMac && e.metaKey);
}

const NAMES: Record<string, string> = {
  mod: isMac ? 'Cmd' : 'Ctrl',
  shift: 'Shift',
  alt: isMac ? 'Option' : 'Alt',
  ctrl: 'Ctrl',
  delete: 'Delete',
  esc: 'Esc',
  space: 'Space',
};

/**
 * Formats a shortcut as plain words for this platform.
 * kbd('mod+shift+z') → "Cmd+Shift+Z" on Mac, "Ctrl+Shift+Z" on Windows.
 */
export function kbd(combo: string): string {
  return combo
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .map((p) => NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p))
    .join('+');
}

/** Wording for the secondary mouse button. */
export const rightClick = isMac ? 'Right-click (two-finger click)' : 'Right-click';
