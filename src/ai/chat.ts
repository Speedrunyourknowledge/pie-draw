import { create } from 'zustand';
import type { Pt } from '../types';
import { DEFAULT_MODEL, describeError, rejectsImages, step, type AiSettings, type Provider, type StepResult, type Turn } from './providers';
import { compact } from './compact';
import { SYSTEM_PROMPT } from './prompt';
import { pictureUrl, type Picture } from './snapshot';
import { TOOLS, beginToolRun, canvasView, runTool, withPicture, type Pointing } from './tools';

const SETTINGS_KEY = 'pie-draw:ai';
const MAX_STEPS = 30; // model calls per message (a scene takes a few dozen batches at most), so a confused model can't loop forever
/** Pictures the user can attach to one message. */
export const MAX_ATTACHMENTS = 4;

export interface LogItem {
  id: number;
  kind: 'user' | 'assistant' | 'error';
  text: string;
  /** Attached pictures, as data: URLs to show. */
  images?: string[];
}

const ENV_PROVIDER: Provider = import.meta.env.VITE_AI_PROVIDER === 'openai' ? 'openai' : 'anthropic';

/**
 * Whether requests can go through the dev server, which adds the key from AI_API_KEY (see
 * vite.config.ts). Used when no key is entered in the panel and the provider and server are the ones it proxies to.
 */
export const usesProxy = (s: AiSettings) =>
  import.meta.env.AI_PROXY === true && !s.apiKey && s.provider === ENV_PROVIDER && s.baseUrl === (import.meta.env.VITE_AI_SERVER_URL ?? '');

/** Which model this is, for remembering what it can do: the same name on another server may differ. */
const modelKey = (s: AiSettings) => `${s.provider} ${s.baseUrl} ${s.model}`;

/** Settings from localStorage, else from VITE_AI_* variables (e.g. in .env.local). */
function readSettings(): AiSettings {
  const env = import.meta.env;
  const fromEnv: AiSettings = {
    provider: ENV_PROVIDER,
    apiKey: '',
    model: env.VITE_AI_MODEL || DEFAULT_MODEL[ENV_PROVIDER],
    baseUrl: env.VITE_AI_SERVER_URL ?? '',
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    return saved ? { ...fromEnv, ...saved } : fromEnv;
  } catch {
    return fromEnv;
  }
}

/** Ready to chat: Anthropic needs a key (or the dev server's); a local OpenAI-compatible server may not. */
export const isConfigured = (s: AiSettings) => !!s.model && (s.provider === 'openai' || !!s.apiKey || usesProxy(s));

interface ChatState {
  open: boolean;
  /** Bumped to ask the panel to focus its input. */
  focusRequest: number;
  log: LogItem[];
  /** The conversation as the model sees it. */
  turns: Turn[];
  busy: boolean;
  settings: AiSettings;
  /** Last pointer position over the canvas, in canvas units: what "here" means. */
  pointer: Pt | null;
  inputFocused: boolean;
  /** Screen x where the canvas stops being covered by the chat panel. */
  visibleLeft: number;
  /**
   * Models (by modelKey) that turned down a picture: they get text in place of pictures until the page
   * reloads or their settings are saved again (in case a different model now runs under the name).
   */
  noVision: string[];

  setOpen: (open: boolean, focus?: boolean) => void;
  send: (text: string, attachments?: Picture[]) => Promise<void>;
  /** Stops the reply in progress and sends this message instead. */
  sendNow: (text: string, attachments?: Picture[]) => void;
  stop: () => void;
  clear: () => void;
  saveSettings: (settings: AiSettings) => void;
  setPointer: (p: Pt | null) => void;
  setInputFocused: (focused: boolean) => void;
  setVisibleLeft: (x: number) => void;
}

let nextId = 1;
let controller: AbortController | null = null;

export const useChat = create<ChatState>()((set, get) => {
  const log = (kind: LogItem['kind'], text: string) => set((st) => ({ log: [...st.log, { id: nextId++, kind, text }] }));
  const pushTurn = (turn: Turn) => set((st) => ({ turns: [...st.turns, turn] }));
  // A message the model never got to act on is dropped, so sending it again doesn't do it twice.
  const dropUnanswered = () =>
    set((st) => (st.turns.at(-1)?.role === 'user' ? { turns: st.turns.slice(0, -1) } : {}));
  const pointing = (): Pointing => ({ pointer: get().pointer, visibleLeft: get().visibleLeft });
  const wantsPictures = () => !get().noVision.includes(modelKey(get().settings));
  /** Ends the reply in progress, noting it in the log as `note`. */
  const abort = (note: string) => {
    if (!controller) return;
    controller.abort();
    controller = null;
    dropUnanswered();
    log('error', note);
    set({ busy: false });
  };

  return {
    open: false,
    focusRequest: 0,
    log: [],
    turns: [],
    busy: false,
    settings: readSettings(),
    pointer: null,
    inputFocused: false,
    visibleLeft: 0,
    noVision: [],

    setOpen: (open, focus = false) => set((st) => ({ open, focusRequest: focus ? st.focusRequest + 1 : st.focusRequest })),

    send: async (text, attachments = []) => {
      const { settings, busy } = get();
      if (busy || (!text.trim() && attachments.length === 0)) return;
      const words = text.trim() || (attachments.length === 1 ? 'Here is a picture.' : 'Here are some pictures.');
      if (attachments.length > 0) set((st) => ({ log: [...st.log, { id: nextId++, kind: 'user', text: text.trim(), images: attachments.map(pictureUrl) }] }));
      else log('user', words);
      // Said every time, so a picture attached again doesn't seem to be ignored.
      if (attachments.length > 0 && !wantsPictures()) log('error', 'This model can’t read images, so your picture wasn’t sent.');
      const logStart = get().log.length;
      // The pointer and canvas are captured when the message is sent, which is when the user is pointing.
      const view = canvasView(pointing());
      controller = new AbortController();
      const { signal } = controller;
      set({ busy: true, turns: compact(get().turns) });
      const message = await withPicture(view, (canvas) => `${words}\n\n<canvas>${canvas}</canvas>`, wantsPictures());
      if (signal.aborted) return;
      pushTurn({ role: 'user', ...message, ...(attachments.length > 0 ? { attachments } : {}) });
      // Through the dev server, the key sent is a placeholder that it swaps for the real one.
      const viaProxy = usesProxy(settings) ? { ...settings, apiKey: 'from-dev-server', baseUrl: `${location.origin}/__ai` } : settings;
      beginToolRun();
      let usedTools = false;
      const ask = async (): Promise<StepResult> => {
        const vision = wantsPictures();
        try {
          return await step(viaProxy, SYSTEM_PROMPT, TOOLS, get().turns, signal, vision);
        } catch (e) {
          // A model that can't read images: carry on with text, and don't try pictures with it again
          // until the user asks to (by reloading or saving its settings).
          if (!vision || signal.aborted || !rejectsImages(e)) throw e;
          set({ noVision: [...get().noVision, modelKey(settings)] });
          const lost = attachments.length > 0 ? 'your picture wasn’t sent, and ' : '';
          log('error', `This model can’t read images, so ${lost}the canvas is sent as text from now on. To try images again, reload the page or save the model settings again.`);
          return step(viaProxy, SYSTEM_PROMPT, TOOLS, get().turns, signal, false);
        }
      };
      try {
        for (let i = 0; i < MAX_STEPS; i++) {
          const res = await ask();
          if (signal.aborted) return;
          pushTurn({ role: 'assistant', text: res.text, calls: res.calls, raw: res.raw });
          if (res.text) log('assistant', res.text);
          if (res.stop === 'refused') log('error', 'The model declined this request.');
          if (res.stop === 'truncated') log('error', 'The reply was cut off.');
          if (res.stop !== 'tools') {
            // Tool use isn't listed (the user sees the canvas change), so a reply that only acted is
            // fine; one that neither acted nor said anything is not.
            if (!usedTools && get().log.length === logStart) log('error', 'The model didn’t respond.');
            return;
          }
          // Run in order: later calls often depend on the selection earlier ones made.
          usedTools = true;
          const results = [];
          for (const c of res.calls) results.push({ id: c.id, ...(await runTool(c.name, c.input, pointing(), wantsPictures())) });
          if (signal.aborted) return;
          pushTurn({ role: 'tool', results });
        }
        log('error', 'Stopped after too many steps.');
      } catch (e) {
        if (signal.aborted) return;
        log('error', describeError(e));
        dropUnanswered();
      } finally {
        // A stopped reply has already handed over; it mustn't mark a newer one as done.
        if (controller?.signal === signal) {
          controller = null;
          set({ busy: false });
        }
      }
    },

    sendNow: (text, attachments = []) => {
      if (!text.trim() && attachments.length === 0) return;
      abort('Interrupted.');
      void get().send(text, attachments);
    },

    stop: () => abort('Stopped.'),

    clear: () => {
      get().stop();
      set({ log: [], turns: [] });
    },

    saveSettings: (settings) => {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // Storage unavailable: the settings last until reload.
      }
      // Saving a model's settings tries pictures with it again (its server may have a different model now).
      set({ settings, noVision: get().noVision.filter((k) => k !== modelKey(settings)) });
    },

    setPointer: (pointer) => set({ pointer }),
    setInputFocused: (inputFocused) => set({ inputFocused }),
    setVisibleLeft: (visibleLeft) => set({ visibleLeft }),
  };
});
