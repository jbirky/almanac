import { describe, expect, it } from 'vitest';
import { contrast } from '@almanac/shared';
import { colorProps, readableShades } from './color.js';

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const PANEL = { light: rgb('#f3f1ed'), dark: rgb('#1f1e1b') };
const tinted = (hex, surface) => rgb(hex).map((c, i) => 0.18 * c + 0.82 * surface[i]);

describe('hand-picked label colors', () => {
  it('reads at 4.5:1 on a tinted chip in both modes, whatever the color', () => {
    for (const hex of ['#e0a800', '#ffff00', '#00ff00', '#ffffff', '#000000', '#1a2b4c', '#ff00ff', '#7f7f7f']) {
      const { light, dark } = readableShades(hex);
      expect(contrast(rgb(light), tinted(light, PANEL.light)), `${hex} in light mode`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(dark), tinted(dark, PANEL.dark)), `${hex} in dark mode`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps a color that already reads, and only darkens or lightens one that does not', () => {
    expect(readableShades('#2a5c9b').light).toBe('#2a5c9b');
    expect(readableShades('#86ade8').dark).toBe('#86ade8');
    const gold = readableShades('#e0a800');
    expect(gold.dark).toBe('#e0a800');
    const [r, g, b] = rgb(gold.light);
    // Darker, and still a gold: red over green over blue.
    expect(r + g + b).toBeLessThan(0xe0 + 0xa8);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('marks palette colors by name and picked ones with their shades', () => {
    expect(colorProps('blue')).toEqual({ 'data-color': 'blue' });
    expect(colorProps(undefined)).toEqual({});
    expect(colorProps('#e0a800')).toEqual({
      'data-color': 'custom',
      style: { '--custom-light': readableShades('#e0a800').light, '--custom-dark': '#e0a800' },
    });
  });
});
