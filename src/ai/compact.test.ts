import { describe, expect, it } from 'vitest';
import { compact } from './compact';
import type { Turn } from './providers';

const pic = { mediaType: 'image/png' as const, data: 'AAAA' };
const many = Array.from({ length: 20 }, (_, i) => ({ type: 'circle', x: i, y: i }));

const turns: Turn[] = [
  { role: 'user', content: 'draw <canvas>{}</canvas>', image: pic, textOnly: 'draw <canvas>{full}</canvas>', attachments: [pic] },
  {
    role: 'assistant',
    text: '',
    calls: [{ id: 't1', name: 'create_shapes', input: { shapes: many } }],
    raw: {
      provider: 'anthropic',
      content: [
        { type: 'thinking', thinking: '', signature: 'x' },
        { type: 'tool_use', id: 't1', name: 'create_shapes', input: { shapes: many } },
      ],
    },
  },
  { role: 'tool', results: [{ id: 't1', content: 'Created 20 shapes', isError: false }, { id: 't2', content: 'x'.repeat(5000), isError: false, image: pic, textOnly: 'y' }] },
  { role: 'assistant', text: 'Done.', calls: [] },
];

describe('compact', () => {
  const out = compact(turns);

  it('drops canvas pictures and shape lists but keeps attached pictures', () => {
    const user = out[0] as Extract<Turn, { role: 'user' }>;
    expect(user.image).toBeUndefined();
    expect(user.textOnly).toBeUndefined();
    expect(user.attachments).toEqual([pic]);
    expect(user.content).toMatch(/^draw <canvas>\{\}<\/canvas>\n\[An older view/);
  });

  it('shortens big create_shapes lists and keeps only plain text and calls', () => {
    const a = out[1] as Extract<Turn, { role: 'assistant' }>;
    expect(a.calls[0].input).toEqual({ shapes_omitted: expect.stringContaining('20 shapes') });
    expect(a.raw).toBeUndefined();
  });

  it('cuts long tool results and their pictures', () => {
    const t = out[2] as Extract<Turn, { role: 'tool' }>;
    expect(t.results[0].content).toBe('Created 20 shapes');
    expect(t.results[1].content).toMatch(/long result/);
    expect(t.results[1].image).toBeUndefined();
  });

  it('gives an empty past reply some text', () => {
    const [a] = compact([{ role: 'assistant', text: '', calls: [], raw: { provider: 'anthropic', content: [{ type: 'thinking' }] } }]);
    expect(a).toEqual({ role: 'assistant', text: '(no reply)', calls: [] });
  });

  it('gives tool calls left without a result one', () => {
    const calls = [{ id: 'a', name: 'select_all', input: {} }, { id: 'b', name: 'view_canvas', input: {} }];
    const stopped: Turn[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', text: '', calls }];
    expect(compact(stopped)[2]).toEqual({ role: 'tool', results: [expect.objectContaining({ id: 'a', isError: true }), expect.objectContaining({ id: 'b', isError: true })] });
    const partial: Turn[] = [...stopped, { role: 'tool', results: [{ id: 'a', content: 'Selected', isError: false }] }, { role: 'user', content: 'again' }];
    const out = compact(partial);
    expect(out).toHaveLength(4);
    expect((out[2] as Extract<Turn, { role: 'tool' }>).results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(partial[2]).toEqual({ role: 'tool', results: [{ id: 'a', content: 'Selected', isError: false }] }); // not changed in place
  });

  it('changes nothing when run again', () => {
    expect(compact(out)).toEqual(out);
  });
});
