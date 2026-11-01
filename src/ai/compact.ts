import type { ToolCall, Turn } from './providers';

// Keeps the conversation sent to the model small however big the drawing gets.

/** Tool results longer than this are cut from past messages, where they're out of date anyway. */
const OLD_RESULT_CHARS = 1500;
/** create_shapes calls with more shapes than this have their list cut from past messages. */
const OLD_BATCH_SHAPES = 8;
const OLD_VIEW_NOTE = '\n[An older view of the canvas was here: its picture or full shape list has been removed. Go by the latest one.]';

/**
 * Shortens the turns of past messages, so the conversation grows with the number of messages, not
 * the size of the drawing: only the latest pictures of the canvas stay (the user's own attached
 * pictures always do), long tool results and big create_shapes lists become short notes.
 *
 * Runs once per message, before it is added, so the history only changes at that point and stays
 * the same (and cached) while the reply runs. Past replies keep only their text and tool calls, the
 * form every provider accepts; the reply in progress is never touched. Running it again changes nothing.
 */
export function compact(turns: Turn[]): Turn[] {
  return answerAll(turns).map((t): Turn => {
    if (t.role === 'user') {
      if (!t.image && t.textOnly === undefined) return t;
      const cut = !!t.image || t.textOnly !== t.content;
      return { role: 'user', content: cut ? t.content + OLD_VIEW_NOTE : t.content, ...(t.attachments ? { attachments: t.attachments } : {}) };
    }
    if (t.role === 'tool') {
      if (!t.results.some((x) => x.image || x.textOnly !== undefined || x.content.length > OLD_RESULT_CHARS)) return t;
      return {
        role: 'tool',
        results: t.results.map((x) => {
          const cut = !!x.image || (x.textOnly !== undefined && x.textOnly !== x.content);
          const content = x.content.length > OLD_RESULT_CHARS ? '[A long result was here. It has been removed and is out of date.]' : x.content + (cut ? OLD_VIEW_NOTE : '');
          return { id: x.id, content, isError: x.isError };
        }),
      };
    }
    const big = (c: ToolCall) =>
      c.name === 'create_shapes' && Array.isArray(c.input.shapes) && c.input.shapes.length > OLD_BATCH_SHAPES;
    const shorten = (input: Record<string, unknown>) => ({ shapes_omitted: `${(input.shapes as unknown[]).length} shapes; the list was removed to save space` });
    const calls = t.calls.map((c) => (big(c) ? { ...c, input: shorten(c.input) } : c));
    // The provider's own copy of the reply is dropped: past replies are sent as plain text and tool
    // calls, which every provider accepts, so this never depends on the details of what a provider
    // puts in its replies (such as Claude's thinking, which must not be sent back once history changes).
    // A reply with nothing in it (refused, or cut off) still needs some text: APIs reject empty messages.
    return { role: 'assistant', text: t.text || (calls.length > 0 ? '' : '(no reply)'), calls };
  });
}

const STOPPED = '[The reply was stopped before this tool finished.]';

/**
 * Gives every tool call a result. A reply stopped while a tool was still running (drawing a picture,
 * say) leaves a call without one, and the APIs reject a history like that.
 */
function answerAll(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    out.push(t);
    if (t.role !== 'assistant' || t.calls.length === 0) continue;
    const next = turns[i + 1];
    const results = next?.role === 'tool' ? next.results : [];
    const answered = new Set(results.map((r) => r.id));
    const missing = t.calls.filter((c) => !answered.has(c.id)).map((c) => ({ id: c.id, content: STOPPED, isError: true }));
    if (missing.length === 0) continue;
    // All results for one reply go in one tool turn, so missing ones join the existing turn if there is one.
    out.push({ role: 'tool', results: [...results, ...missing] });
    if (next?.role === 'tool') i++;
  }
  return out;
}
