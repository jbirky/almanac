import { describe, expect, it } from 'vitest';
import { checkOffs, widgetSnapshot } from './widget-data.js';

const task = (id, due, extra = {}) => ({ id, title: `task ${id}`, due, status: 'open', category: null, ...extra });

describe("the Today widget's copy", () => {
  it('takes the open tasks due by a week from today, soonest first, overdue ones too', () => {
    const tasks = [
      task('later', '2026-11-05'),
      task('week', '2026-11-04'),
      task('today', '2026-10-28', { category: 'paper', position: 3, subtasks: 2 }),
      task('late', '2026-10-20'),
      task('undated', null),
      task('done', '2026-10-28', { status: 'done' }),
    ];
    expect(widgetSnapshot(tasks, '2026-10-28', 1700000000000)).toEqual({
      at: 1700000000000,
      tasks: [
        { id: 'late', title: 'task late', due: '2026-10-20', category: null },
        { id: 'today', title: 'task today', due: '2026-10-28', category: 'paper' },
        { id: 'week', title: 'task week', due: '2026-11-04', category: null },
      ],
    });
  });

  it('takes at most 80, and an untitled task as an empty title', () => {
    const many = Array.from({ length: 100 }, (_, i) => task(`t${i}`, '2026-10-28', { title: i ? `t${i}` : null }));
    const { tasks } = widgetSnapshot(many, '2026-10-28', 0);
    expect(tasks).toHaveLength(80);
    expect(tasks[0].title).toBe('');
  });
});

describe('tasks checked off in the widget', () => {
  it('are checked off here if they’re still open, and left as they are if done or deleted meanwhile', () => {
    const tasks = {
      open: { status: 'open', deleted: 0 },
      done: { status: 'done', deleted: 0 },
      gone: { status: 'open', deleted: 1 },
    };
    expect(checkOffs(['open', 'done', 'gone', 'unknown'], (id) => tasks[id] ?? null)).toEqual(['open']);
  });
});
