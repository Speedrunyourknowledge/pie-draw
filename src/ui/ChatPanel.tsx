import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MAX_ATTACHMENTS, isConfigured, usesProxy, useChat, type LogItem } from '../ai/chat';
import { DEFAULT_URL, MODEL_PLACEHOLDER, type AiSettings, type Provider } from '../ai/providers';
import { IMAGE_TYPES, pictureUrl, readImageFile, type Picture } from '../ai/snapshot';
import { useStore } from '../store';
import { toScreen, toWorld } from '../view';
import { PointerHint } from './PointerHint';

const EXAMPLES = [
  'Put a red circle here',
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
          <span className="chat-model" data-tip={settings.model}>{settings.model}</span>
          <ClearButton />
          <button
            className={`chat-icon${showSettings ? ' on' : ''}`}
            onClick={() => setEditing(!editing)}
            disabled={!isConfigured(settings)}
            data-tip="Connect model"
            aria-label="Connect model"
          >
            {/* lucide: key-round */}
            <svg viewBox="0 0 24 24" strokeWidth={2} strokeLinejoin="round">
              <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
              <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
            </svg>
          </button>
          <button className="chat-icon" onClick={close} data-tip="Close (Esc in the message box)" aria-label="Close assistant">
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
    <button className="chat-icon" onClick={() => useChat.getState().clear()} disabled={empty} data-tip="Clear the conversation" aria-label="Clear the conversation">
      <svg viewBox="0 0 20 20"><path d="M4 6 H16 M8 6 V4 H12 V6 M6 6 L7 17 H13 L14 6" /></svg>
    </button>
  );
}

/** Shown under a message on hover, in the gap before the next one. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      className={`chat-copy${copied ? ' copied' : ''}`}
      onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => {})}
      data-tip="Copy"
      aria-label={copied ? 'Copied' : 'Copy message'}
    >
      {copied ? (
        // lucide: check
        <svg viewBox="0 0 24 24" strokeWidth={2}><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        // lucide: copy, with the back square's lines run up to the front one
        <svg viewBox="0 0 24 24" strokeWidth={2}>
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M8 16H4c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2v4" />
        </svg>
      )}
    </button>
  );
}

/** `onLeave` runs when Esc leaves the message box, with the pointer still hidden from typing. */
function Conversation({ onLeave }: { onLeave: () => void }) {
  const log = useChat((s) => s.log);
  const busy = useChat((s) => s.busy);
  const status = useChat((s) => s.status);
  const focusRequest = useChat((s) => s.focusRequest);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Picture[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Follows new messages and streaming text, unless the user has scrolled up to read.
  const lastText = log.at(-1)?.text.length ?? 0;
  const thinkingGroups = groupThinking(log);
  const pinned = useRef(true);
  useEffect(() => {
    if (pinned.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [log.length, lastText, busy, status]);

  useEffect(() => inputRef.current?.focus(), [focusRequest]);

  // Starts two lines tall (rows={2}) and grows with the text, up to a few lines.
  useLayoutEffect(() => {
    const el = inputRef.current!;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // While a reply is running, sending interrupts it: the new message goes now, not after.
  const send = (msg = text) => {
    if (!msg.trim() && attachments.length === 0) return;
    if (busy) useChat.getState().sendNow(msg, attachments);
    else void useChat.getState().send(msg, attachments);
    setText('');
    setAttachments([]);
  };
  const stop = () => useChat.getState().stop();
  const hasText = !!text.trim() || attachments.length > 0;

  /** Checks and reads the files, keeping the images and naming the rest in a toast. */
  const attach = async (files: File[]) => {
    const room = MAX_ATTACHMENTS - attachments.length;
    if (files.length > room) useStore.getState().showToast(`Up to ${MAX_ATTACHMENTS} pictures per message.`, 'error');
    const read: Picture[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        read.push(await readImageFile(file));
      } catch (e) {
        useStore.getState().showToast(e instanceof Error ? e.message : String(e), 'error');
      }
    }
    if (read.length > 0) setAttachments((a) => [...a, ...read].slice(0, MAX_ATTACHMENTS));
    inputRef.current?.focus();
  };

  return (
    <>
      <div
        className="chat-log"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {log.length === 0 && (
          <div className="chat-empty">
            <p>After typing, <b>point with the mouse</b> to indicate “here” or “this”, then press <b>Enter</b>.</p>
            <p>Here are some examples to get you started:</p>
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
          </div>
        )}
        {log.map((item) => item.kind === 'thinking' ? (
          // A message's thinking shows as one section, where its first step was.
          thinkingGroups.get(item.id) && <Thinking key={item.id} steps={thinkingGroups.get(item.id)!} />
        ) : (
          <div key={item.id} className={`chat-msg ${item.kind}${item.images ? ' has-images' : ''}`}>
            {item.images && (
              <div className="chat-msg-images">
                {item.images.map((src, i) => <img key={i} src={src} alt="Attached picture" />)}
              </div>
            )}
            {item.text && <span>{item.text}</span>}
            {(item.kind === 'user' || item.kind === 'assistant') && <CopyButton text={item.text} />}
          </div>
        ))}
        {busy && (
          <div className="chat-msg working" aria-label={status ?? 'Working'}>
            <i /><i /><i />
            {status && <span className="chat-status">{status}</span>}
          </div>
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {attachments.length > 0 && (
          <div className="chat-attachments">
            {attachments.map((p, i) => (
              <div key={i} className="chat-attachment">
                <img src={pictureUrl(p)} alt="Attached picture" />
                <button type="button" onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))} data-tip="Remove" aria-label="Remove picture">
                  <svg viewBox="0 0 20 20"><path d="M6 6 L14 14 M14 6 L6 14" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          rows={2}
          value={text}
          placeholder="Ask the assistant…"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            // Pasted images attach, through the same checks as uploads; pasted text goes in as usual.
            const files = [...e.clipboardData.files];
            if (files.length === 0) return;
            e.preventDefault();
            void attach(files);
          }}
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
        <div className="chat-input-bar">
        <AttachMenu onFiles={attach} disabled={attachments.length >= MAX_ATTACHMENTS} />
        <span className="chat-input-gap" />
        {/* Keyed, so React never turns the stop button into the send button under a click: the
            click would then finish as a submit. Neither button submits; Enter and clicks go through send(). */}
        {busy && (
          <button key="stop" type="button" className="chat-send stop" onClick={stop} data-tip="Stop" data-tip-side="right" aria-label="Stop">
            <svg viewBox="0 0 20 20"><rect x="6" y="6" width="8" height="8" rx="1.5" /></svg>
          </button>
        )}
        {(!busy || hasText) && (
          <button
            key="send"
            type="button"
            className="chat-send"
            onClick={() => send()}
            disabled={!hasText}
            data-tip={busy ? 'Send now (Enter)' : 'Send (Enter)'}
            data-tip-side="right"
            aria-label={busy ? 'Send now' : 'Send'}
          >
            <svg viewBox="0 0 20 20"><path d="M10 16 V4 M5 9 L10 4 L15 9" /></svg>
          </button>
        )}
        </div>
      </form>
    </>
  );
}

/**
 * Gathers each message's thinking steps (one per model call while it works), keyed by the id of
 * the first step, where the section is shown. A message runs from one user item to the next.
 */
function groupThinking(log: LogItem[]): Map<number, LogItem[]> {
  const groups = new Map<number, LogItem[]>();
  let current: LogItem[] | null = null;
  for (const item of log) {
    if (item.kind === 'user') current = null;
    else if (item.kind === 'thinking') {
      if (!current) groups.set(item.id, (current = []));
      current.push(item);
    }
  }
  return groups;
}

/**
 * A message's thinking, as one section. While the model is thinking it's open on the step being
 * written; once done it folds into a line. Opened by the user, it shows every step.
 */
function Thinking({ steps }: { steps: LogItem[] }) {
  const live = steps.some((s) => !s.done);
  // null: follow the reply (open while live); otherwise what the user chose.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? live;
  const shown = chosen ? steps : steps.slice(-1);
  const label = live ? 'Thinking…' : steps.length > 1 ? `Thought · ${steps.length} steps` : 'Thought';
  return (
    <div className={`chat-msg thinking-log${open ? ' open' : ''}${live ? ' live' : ''}`}>
      <button type="button" className="chat-thinking-toggle" onClick={() => setChosen(!open)} aria-expanded={open}>
        {label}
        <svg viewBox="0 0 20 20" aria-hidden><path d="M8 6 L12 10 L8 14" /></svg>
      </button>
      {open && (
        <div className="chat-thinking-text">
          {shown.map((step) => <p key={step.id}>{step.text.trim()}</p>)}
        </div>
      )}
    </div>
  );
}

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'anthropic', label: 'Claude' },
  { id: 'openai', label: 'OpenAI-Compatible' },
];

/** The + button under the message box, opening a menu with "Upload image". */
function AttachMenu({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  return (
    <div className="chat-attach" ref={rootRef}>
      <button
        type="button"
        className={`chat-plus${open ? ' on' : ''}`}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        data-tip={disabled ? `Up to ${MAX_ATTACHMENTS} pictures` : 'Add'}
        data-tip-side="right"
        aria-label="Add"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* lucide: plus */}
        <svg viewBox="0 0 24 24" strokeWidth={2}><path d="M5 12h14" /><path d="M12 5v14" /></svg>
      </button>
      {open && (
        <div className="chat-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              setOpen(false);
              fileRef.current?.click();
            }}
          >
            {/* lucide: image */}
            <svg viewBox="0 0 24 24" strokeWidth={2}>
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            Upload image
          </button>
        </div>
      )}
      {/* The picker offers images only; readImageFile checks each file again, since a picker can be told to show all files. */}
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = ''; // so choosing the same file again still fires
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}

function Settings({ onDone }: { onDone: () => void }) {
  const [draft, setDraft] = useState<AiSettings>(useChat.getState().settings);
  const set = (patch: Partial<AiSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const pickProvider = (provider: Provider) =>
    set({
      provider,
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
      <p>Connect a model to chat with.</p>
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
          placeholder={usesProxy({ ...draft, apiKey: '' }) ? 'Using AI_API_KEY from .env.local' : ''}
          autoComplete="off"
        />
      </label>
      <label>
        Model
        <input value={draft.model} onChange={(e) => set({ model: e.target.value })} placeholder={MODEL_PLACEHOLDER[draft.provider]} required />
      </label>
      <label>
        <span>Server URL <span className="optional">(optional)</span></span>
        <input value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder={DEFAULT_URL[draft.provider]} />
      </label>
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
