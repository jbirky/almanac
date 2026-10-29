import { describe, expect, it } from 'vitest';
import { moveCategory, orderCategories } from '../src/categories.js';

describe('category order', () => {
  it('puts categories in the chosen order, then the rest alphabetically whatever their case', () => {
    expect(orderCategories(['zeta', 'paper', 'Alpha', 'errands'], ['paper', 'errands'])).toEqual(['paper', 'errands', 'Alpha', 'zeta']);
    expect(orderCategories(['b', 'a'], [])).toEqual(['a', 'b']);
    expect(orderCategories(['b', 'a'], ['gone', 'b'])).toEqual(['b', 'a']);
  });

  it('moves a category among those shown, keeping the places of ones not shown after them', () => {
    expect(moveCategory(['errands', 'observing', 'paper'], [], 'paper', 0)).toEqual(['paper', 'errands', 'observing']);
    expect(moveCategory(['paper', 'errands'], ['paper', 'errands'], 'paper', 1)).toEqual(['errands', 'paper']);
    // "travel" has no open tasks just now, so it isn't shown; it stays ordered.
    expect(moveCategory(['paper', 'observing'], ['paper', 'travel', 'observing'], 'observing', 0)).toEqual(['observing', 'paper', 'travel']);
  });
});
