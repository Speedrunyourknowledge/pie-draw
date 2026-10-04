import { useStore } from '../store';
import { SHAPE_TYPES, type DocFile, type Shape } from '../types';

// The File System Access API is Chrome/Edge-only and not in TypeScript's DOM lib yet.
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
declare global {
  interface Window {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: PickerType[];
    }) => Promise<FileSystemFileHandle>;
    showOpenFilePicker?: (opts: {
      types?: PickerType[];
      multiple?: boolean;
    }) => Promise<FileSystemFileHandle[]>;
  }
}

const TYPES: PickerType[] = [
  { description: 'Pie Draw drawing', accept: { 'application/json': ['.json'] } },
];

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

// Safari, iPadOS/iOS (every browser there is WebKit) and Android lack the pickers.
// There we fall back to a download link and <input type="file">, which give no
// file handle, so every save is a fresh download instead of an overwrite.
function hasPickers(): boolean {
  return !!(window.showSaveFilePicker && window.showOpenFilePicker);
}

function serialize(): string {
  const doc: DocFile = { version: 1, shapes: useStore.getState().shapes };
  return JSON.stringify(doc, null, 2);
}

function downloadDoc(): void {
  const name = useStore.getState().fileName ?? 'drawing.json';
  const url = URL.createObjectURL(new Blob([serialize()], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a); // older iOS Safari ignores clicks on detached links
  a.click();
  a.remove();
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  useStore.getState().markSaved(null, name);
  useStore.getState().showToast(`Downloaded ${name}`);
}

/** Resolves with the chosen file, or null if the user cancels. */
function pickFileFallback(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.append(input); // older iOS Safari won't fire change on a detached input
    input.click();
  });
}

function confirmDiscard(): boolean {
  return !useStore.getState().dirty || window.confirm('Discard unsaved changes?');
}

export function newDoc(): void {
  if (!confirmDiscard()) return;
  useStore.getState().newDoc();
}

export async function saveDoc(saveAs = false): Promise<void> {
  if (!hasPickers()) return downloadDoc();
  const st = useStore.getState();
  try {
    let handle = st.fileHandle;
    if (!handle || saveAs) {
      handle = await window.showSaveFilePicker!({
        suggestedName: st.fileName ?? 'drawing.json',
        types: TYPES,
      });
    }
    const writable = await handle.createWritable();
    await writable.write(serialize());
    await writable.close();
    useStore.getState().markSaved(handle, handle.name);
    useStore.getState().showToast(`Saved ${handle.name}`);
  } catch (err) {
    if (!isAbort(err)) useStore.getState().showToast(`Could not save: ${String(err)}`, 'error');
  }
}

export async function openDoc(): Promise<void> {
  if (!confirmDiscard()) return;
  try {
    let handle: FileSystemFileHandle | null = null;
    let file: File | null;
    if (hasPickers()) {
      [handle] = await window.showOpenFilePicker!({ types: TYPES, multiple: false });
      file = await handle.getFile();
    } else {
      file = await pickFileFallback();
      if (!file) return;
    }
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error('not valid JSON');
    }
    const shapes = validateDoc(data);
    useStore.getState().loadDoc(shapes, handle, file.name);
    useStore.getState().showToast(`Opened ${file.name}`);
  } catch (err) {
    if (!isAbort(err)) {
      const msg = err instanceof Error ? err.message : String(err);
      useStore.getState().showToast(`Could not open file: ${msg}`, 'error');
    }
  }
}

// ---- validation ----

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isColor = (v: unknown) => v === null || typeof v === 'string';
const isPoints = (v: unknown, min: number) =>
  Array.isArray(v) &&
  v.length >= min &&
  v.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]));

function validShape(s: Record<string, unknown>): boolean {
  if (typeof s.id !== 'string' || !SHAPE_TYPES.includes(s.type as Shape['type'])) return false;
  if (![s.x, s.y, s.scaleX, s.scaleY, s.rotation, s.strokeWidth].every(isNum)) return false;
  if (!isColor(s.fill) || !isColor(s.stroke)) return false;
  switch (s.type) {
    case 'square':
    case 'rectangle':
      return isNum(s.w) && isNum(s.h);
    case 'circle':
    case 'ellipse':
      return isNum(s.rx) && isNum(s.ry);
    case 'triangle':
      return isPoints(s.points, 3) && (s.points as unknown[]).length === 3;
    case 'freehand':
      return isPoints(s.points, 1);
  }
  return false;
}

/** Throws a readable error if `data` is not a version-1 Pie Draw document. */
export function validateDoc(data: unknown): Shape[] {
  if (typeof data !== 'object' || data === null) throw new Error('not a Pie Draw file');
  const d = data as Record<string, unknown>;
  if (d.version !== 1) throw new Error(`unsupported version ${String(d.version)}`);
  if (!Array.isArray(d.shapes)) throw new Error('missing shape list');
  d.shapes.forEach((s, i) => {
    if (typeof s !== 'object' || s === null || !validShape(s as Record<string, unknown>)) {
      throw new Error(`shape #${i + 1} is malformed`);
    }
  });
  // Duplicate ids would break selection; reassigning them is harmless.
  const seen = new Set<string>();
  return (d.shapes as Shape[]).map((s) => {
    if (seen.has(s.id)) s = { ...s, id: crypto.randomUUID() };
    seen.add(s.id);
    return s;
  });
}
