import { describe, expect, it } from 'vitest';
import { parseCapture } from '../src/capture.js';

// Wednesday, 14 October 2026, mid-morning local time.
const WED = new Date(2026, 9, 14, 10, 0);

describe('quick capture', () => {
  it('takes a date after "due" as the due date, and the first #word as the category', () => {
    expect(parseCapture('submit abstract due fri #paper', WED)).toEqual({
      title: 'submit abstract',
      due: '2026-10-16',
      category: 'paper',
    });
  });

  it('takes any other date as the due date too', () => {
    expect(parseCapture('call dentist tomorrow', WED)).toEqual({ title: 'call dentist', due: '2026-10-15', category: null });
  });

  it('leaves a line without dates alone, and any #word after the first', () => {
    expect(parseCapture('#astro read the TESS paper #later', WED)).toEqual({
      title: 'read the TESS paper #later',
      due: null,
      category: 'astro',
    });
  });
});
