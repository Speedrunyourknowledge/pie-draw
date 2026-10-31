import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isConfigured, usesProxy, useChat } from '../ai/chat';
import { DEFAULT_MODEL, DEFAULT_URL, type AiSettings, type Provider } from '../ai/providers';
import { useStore } from '../store';
import { toScreen, toWorld } from '../view';
import { PointerHint } from './PointerHint';

const EXAMPLES = [
  'Put a red circle here',
  'Draw three blue squares in a row',
  'Make this twice as big',
  'Copy the triangle and paste it here',
];

/** A single assistant conversation in a panel on the left. Shapes it makes go through the same actions as the UI. */
export function ChatPanel() {
  const open = useChat((s) => s.open);
  const settings = useChat((s) => s.settings);
  const [editing, setEditing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const mouse = useRef<{ x: number; y: number } | null>(null); // last pointer position on screen
  const [hint, setHint] = useState<{ x: number; y: number } | null>(null);
  const endHint = useCallback(() => setHint(null), []);
  // Only over the canvas, where the pointer marks where the next stroke starts.
  const showHint = () => {
    const at = mouse.current;
    if (at && document.elementFromPoint(at.x, at.y)?.closest('.canvas')) setHint(at);
  };
  const showSettings = editing || !isConfigured(settings);

  // Track where the pointer is on the canvas, so "here" means something when a message is sent.
  useEffect(() => {
    if (!open) return;
    const move = (e: PointerEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY };
      if (!(e.target as Element | null)?.closest?.('.canvas')) return;
      useChat.getState().setPointer(toWorld([e.clientX, e.clientY], useStore.getState().view));
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [open]);

  // Pressing anywhere outside the message box ends aiming. On the canvas the press does only that,
  // so it never draws or selects; elsewhere (the toolbar, say) it goes on to do its usual thing.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!useChat.getState().inputFocused) return;
      const target = e.target as Element | null;
      if (target?.closest?.('.chat-input')) return;
      if (target?.closest?.('.canvas')) {
        e.preventDefault();
        e.stopPropagation();
      }
      (document.activeElement as HTMLElement | null)?.blur();
    };
    window.addEventListener('pointerdown', down, true); // capture, so it runs before the canvas sees the press
    return () => window.removeEventListener('pointerdown', down, true);
  }, [open]);

  // The panel covers the left of the canvas; the assistant places shapes to the right of it.
  useLayoutEffect(() => {
    useChat.getState().setVisibleLeft(open && panelRef.current ? panelRef.current.getBoundingClientRect().right : 0);
  }, [open]);

  if (!open) return null;
  const close = () => useChat.getState().setOpen(false);

  return (
    <>
      <aside className="chat" ref={panelRef} aria-label="Assistant">
        <header className="chat-head">
          <SparkleIcon />
          <span className="chat-title">Assistant</span>
          <span className="chat-model" title={settings.model}>{settings.model}</span>
          <ClearButton />
          <button
            className={`chat-icon${showSettings ? ' on' : ''}`}
            onClick={() => setEditing(!editing)}
            disabled={!isConfigured(settings)}
            title="Model settings"
            aria-label="Model settings"
          >
            <svg viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="2.5" />
              <path d="M10 2.5 V4.5 M10 15.5 V17.5 M2.5 10 H4.5 M15.5 10 H17.5 M4.7 4.7 L6.1 6.1 M13.9 13.9 L15.3 15.3 M4.7 15.3 L6.1 13.9 M13.9 6.1 L15.3 4.7" />
            </svg>
          </button>
          <button className="chat-icon" onClick={close} title="Close (Esc in the message box)" aria-label="Close assistant">
            <svg viewBox="0 0 20 20"><path d="M5 5 L15 15 M15 5 L5 15" /></svg>
          </button>
        </header>
        {showSettings ? <Settings onDone={() => setEditing(false)} /> : <Conversation onLeave={showHint} />}
      </aside>
      <PointerMarker />
      {hint && <PointerHint at={hint} onDone={endHint} />}
    </>
  );
}

function ClearButton() {
  const empty = useChat((s) => s.log.length === 0);
  return (
    <button className="chat-icon" onClick={() => useChat.getState().clear()} disabled={empty} title="Clear the conversation" aria-label="Clear the conversation">
      <svg viewBox="0 0 20 20"><path d="M4 6 H16 M8 6 V4 H12 V6 M6 6 L7 17 H13 L14 6" /></svg>
    </button>
  );
}

/** `onLeave` runs when Esc leaves the message box, with the pointer still hidden from typing. */
function Conversation({ onLeave }: { onLeave: () => void }) {
  const log = useChat((s) => s.log);
  const busy = useChat((s) => s.busy);
  const focusRequest = useChat((s) => s.focusRequest);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [log.length, busy]);

  useEffect(() => inputRef.current?.focus(), [focusRequest]);

  // Grow with the text, up to a few lines.
  useLayoutEffect(() => {
    const el = inputRef.current!;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const send = (msg = text) => {
    if (busy || !msg.trim()) return;
    void useChat.getState().send(msg);
    setText('');
  };

  return (
    <>
      <div className="chat-log" ref={listRef}>
        {log.length === 0 && (
          <div className="chat-empty">
            <p>Ask for shapes and edits in plain words. <b>Point with the mouse</b> on the canvas to say where “here” is, or which shape “this” is.</p>
            <div className="chat-examples">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    setText(ex);
                    inputRef.current?.focus(); // ready to point and press Enter
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
            <p className="chat-tip">Pick one, point at the canvas, then press <b>Enter</b>.</p>
          </div>
        )}
        {log.map((item) => (
          <div key={item.id} className={`chat-msg ${item.kind}`}>
            {item.kind === 'action' && (
              <svg viewBox="0 0 20 20" aria-hidden><path d="M5 10.5 L8.5 14 L15 6.5" /></svg>
            )}
            <span>{item.text}</span>
          </div>
        ))}
        {busy && <div className="chat-msg thinking" aria-label="Working"><i /><i /><i /></div>}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder="Ask the assistant…"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => useChat.getState().setInputFocused(true)}
          onBlur={() => useChat.getState().setInputFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.currentTarget.blur(); // back to the canvas, where Esc and the shortcuts work again
              onLeave();
            }
          }}
        />
        {busy ? (
          <button type="button" className="chat-send stop" onClick={() => useChat.getState().stop()} title="Stop" aria-label="Stop">
            <svg viewBox="0 0 20 20"><rect x="6" y="6" width="8" height="8" rx="1.5" /></svg>
          </button>
        ) : (
          <button type="submit" className="chat-send" disabled={!text.trim()} title="Send (Enter)" aria-label="Send">
            <svg viewBox="0 0 20 20"><path d="M10 16 V4 M5 9 L10 4 L15 9" /></svg>
          </button>
        )}
      </form>
    </>
  );
}

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'anthropic', label: 'Claude' },
  { id: 'openai', label: 'OpenAI-compatible' },
];

function Settings({ onDone }: { onDone: () => void }) {
  const [draft, setDraft] = useState<AiSettings>(useChat.getState().settings);
  const set = (patch: Partial<AiSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const pickProvider = (provider: Provider) =>
    // Swap in the new provider's default model, unless the user typed their own.
    set({
      provider,
      model: !draft.model || draft.model === DEFAULT_MODEL[draft.provider] ? DEFAULT_MODEL[provider] : draft.model,
      baseUrl: '', // each provider has its own address
    });

  return (
    <form
      className="chat-settings"
      onSubmit={(e) => {
        e.preventDefault();
        useChat.getState().saveSettings({ ...draft, apiKey: draft.apiKey.trim(), model: draft.model.trim(), baseUrl: draft.baseUrl.trim() });
        onDone();
      }}
    >
      <p>Connect a model to chat with. Settings stay in this browser.</p>
      <div className="chat-seg" role="radiogroup" aria-label="Provider">
        {PROVIDERS.map((p) => (
          <button type="button" key={p.id} role="radio" aria-checked={draft.provider === p.id} className={draft.provider === p.id ? 'on' : ''} onClick={() => pickProvider(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <label>
        API key
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => set({ apiKey: e.target.value })}
          placeholder={usesProxy({ ...draft, apiKey: '' }) ? 'Using AI_API_KEY from .env.local' : draft.provider === 'anthropic' ? 'sk-ant-…' : 'Leave empty for local servers'}
          autoComplete="off"
        />
      </label>
      <label>
        Model
        <input value={draft.model} onChange={(e) => set({ model: e.target.value })} placeholder={DEFAULT_MODEL[draft.provider] || 'Model name'} required />
      </label>
      <label>
        <span>Server URL <span className="optional">(optional)</span></span>
        <input value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder={DEFAULT_URL[draft.provider]} />
      </label>
      {draft.provider === 'openai' && (
        <p className="hint">Leave empty for OpenAI. For another service, use the URL from its docs, e.g. <code>https://openrouter.ai/api/v1</code>, or <code>http://localhost:11434/v1</code> for Ollama. The model must support tool calling.</p>
      )}
      <button type="submit" className="chat-save" disabled={!isConfigured({ ...draft, apiKey: draft.apiKey.trim(), model: draft.model.trim() })}>
        Save
      </button>
    </form>
  );
}

/** While typing, marks the spot "here" refers to. */
function PointerMarker() {
  const pointer = useChat((s) => s.pointer);
  const focused = useChat((s) => s.inputFocused);
  const view = useStore((s) => s.view);
  if (!pointer || !focused) return null;
  const [x, y] = toScreen(pointer, view);
  return (
    <svg className="here-marker" style={{ left: x, top: y }} viewBox="-12 -12 24 24" aria-hidden>
      <circle r="7" />
      <path d="M0 -11 V-4 M0 4 V11 M-11 0 H-4 M4 0 H11" />
    </svg>
  );
}

export function SparkleIcon() {
  return (
    <svg viewBox="0 0 20 20" className="sparkle-icon" aria-hidden>
      <path d="M9 3 L10.4 7.6 L15 9 L10.4 10.4 L9 15 L7.6 10.4 L3 9 L7.6 7.6 Z" />
      <path d="M15 13 L15.6 14.4 L17 15 L15.6 15.6 L15 17 L14.4 15.6 L13 15 L14.4 14.4 Z" />
    </svg>
  );
}
