import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas';
import { useStore } from './store';
import { ColorPicker } from './ui/ColorPicker';
import { HelpPanel } from './ui/HelpPanel';
import { Toast } from './ui/Toast';
import { TopBar } from './ui/TopBar';
import { NavControls } from './ui/NavControls';

export default function App() {
  const fileName = useStore((s) => s.fileName);
  const dirty = useStore((s) => s.dirty);
  const menuOpen = useStore((s) => s.mode === 'menuOpen');

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${fileName ?? 'Untitled'} — Pie Draw`;
  }, [fileName, dirty]);

  return (
    <div className={menuOpen ? 'app menu-open' : 'app'}>
      <Canvas />
      <TopBar />
      {/* One corner cluster for the few on-screen controls, away from the work area. */}
      <div className="corner">
        <ColorPicker />
        <NavControls />
      </div>
      <HelpPanel />
      <Toast />
    </div>
  );
}
