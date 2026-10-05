import { useEffect } from 'react';
import { newDoc, openDoc, saveDoc } from './file/fileOps';
import { isMod } from './platform';
import { useStore } from './store';
import { PALETTE } from './types';
import { fitToContent, resetZoom, selectAdjacent, zoomIn, zoomOut } from './view';

const PAN_STEP = 60;

/** onMenuKey gets first look at each key and returns true if the pie menu used it (M, or keys in an open menu). */
export function useKeyboard(onEscape: () => void, onMenuKey: (e: KeyboardEvent) => boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = isMod(e); // ⌘ on Mac, Ctrl on Windows/Linux
      const key = e.key.toLowerCase();
      let handled = true;

      if (st.helpOpen) {
        // The help panel only listens for ways to close it.
        if (key === 'escape' || key === '?') st.setHelpOpen(false);
        else handled = false;
        if (handled) e.preventDefault();
        return;
      }

      if (onMenuKey(e)) {
        e.preventDefault();
        return;
      }

      if (mod && key === 'z') {
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && key === 'y') st.redo(); // Windows convention
      else if (mod && key === 'x') st.cut();
      else if (mod && key === 'c') st.copy();
      else if (mod && key === 'v') st.paste();
      else if (mod && key === 'a') st.selectAll();
      else if (mod && key === 's') void saveDoc(e.shiftKey);
      else if (mod && key === 'o') void openDoc();
      // Chrome reserves ⌘N / Ctrl+N for a new window, so New is ⌘⌥N / Ctrl+Alt+N.
      else if (mod && e.altKey && e.code === 'KeyN') newDoc();
      else if (mod && (key === '=' || key === '+')) zoomIn();
      else if (mod && key === '-') zoomOut();
      else if (mod && key === '0') resetZoom();
      else if (mod) handled = false; // leave other browser shortcuts alone
      else if (key === 'delete' || key === 'backspace') st.deleteSelected();
      else if (key === 'escape') onEscape();
      else if (key === '?' || (key === '/' && e.shiftKey)) st.setHelpOpen(true);
      else if (key === '=' || key === '+') zoomIn();
      else if (key === '-' || key === '_') zoomOut();
      else if (key === '0') resetZoom();
      else if (key === 'f') fitToContent();
      // Tab steps through the shapes, unless focus is on a control, where it moves focus as usual.
      else if (key === 'tab' && !(document.activeElement instanceof HTMLElement && document.activeElement !== document.body)) {
        selectAdjacent(e.shiftKey ? -1 : 1);
      }
      else if (key === 'v') st.setTool(st.tool === 'select' ? 'draw' : 'select');
      else if (key === 'h') st.setTool(st.tool === 'hand' ? 'draw' : 'hand');
      else if (key === 'e') st.setTool(st.tool === 'eraser' ? 'draw' : 'eraser');
      // Shift+digit (matched by physical key, since Shift changes e.key) sets the fill; 0 clears it.
      else if (e.shiftKey && /^Digit[0-5]$/.test(e.code)) {
        const n = Number(e.code.slice(5));
        st.setFill(n === 0 ? null : PALETTE[n - 1].value);
      } else if (/^[1-5]$/.test(key)) st.setColor(PALETTE[Number(key) - 1].value);
      else if (key.startsWith('arrow')) {
        const dx = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : 0;
        const dy = key === 'arrowup' ? -1 : key === 'arrowdown' ? 1 : 0;
        // Arrows nudge the selection, or pan the canvas like a map when nothing is selected.
        if (st.selectedIds.length > 0) st.nudge(dx * (e.shiftKey ? 10 : 1), dy * (e.shiftKey ? 10 : 1));
        else st.panBy(-dx * PAN_STEP, -dy * PAN_STEP);
      } else handled = false;

      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape, onMenuKey]);
}
