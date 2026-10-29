import { describe, expect, it } from 'vitest';
import { taskPositions } from '../src/positions.js';

const t = (id, position = null) => ({ id, position });

describe('task positions', () => {
  it('numbers a whole category, in the order shown, the first time a task is moved in it', () => {
    expect(taskPositions('c', [t('a'), t('b')], 0)).toEqual([
      { id: 'c', position: 1 },
      { id: 'a', position: 2 },
      { id: 'b', position: 3 },
    ]);
    // A new task (no position yet) among ones already moved: all are numbered again.
    expect(taskPositions('c', [t('new'), t('a', 1), t('b', 2)], 2)).toEqual([
      { id: 'new', position: 1 },
      { id: 'a', position: 2 },
      { id: 'c', position: 3 },
      { id: 'b', position: 4 },
    ]);
  });

  it('then gives only the moved task a number between its new neighbours', () => {
    const others = [t('a', 1), t('b', 2), t('c', 3)];
    expect(taskPositions('x', others, 0)).toEqual([{ id: 'x', position: 0 }]);
    expect(taskPositions('x', others, 1)).toEqual([{ id: 'x', position: 1.5 }]);
    expect(taskPositions('x', others, 3)).toEqual([{ id: 'x', position: 4 }]);
    expect(taskPositions('x', [], 0)).toEqual([{ id: 'x', position: 1 }]);
  });

  it('numbers them all again when no number fits between two', () => {
    const others = [t('a', 1), t('b', 1 + Number.EPSILON)];
    expect(taskPositions('x', others, 1)).toEqual([
      { id: 'a', position: 1 },
      { id: 'x', position: 2 },
      { id: 'b', position: 3 },
    ]);
  });
});
