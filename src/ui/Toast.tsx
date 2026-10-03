import { useStore } from '../store';

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  // Keyed by id so each new message restarts the CSS fade.
  return (
    <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">
      {toast.text}
    </div>
  );
}
