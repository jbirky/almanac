import { describe, expect, it } from 'vitest';
import { createClock, parseHlc } from '../src/hlc.js';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';

describe('hybrid logical clock', () => {
  it('produces strictly increasing timestamps even when the wall clock stalls', () => {
    const clock = createClock(A, null, () => 1_000);
    const stamps = Array.from({ length: 5 }, () => clock.send());
    expect([...stamps].sort()).toEqual(stamps);
    expect(new Set(stamps).size).toBe(5);
  });

  it('never moves backward when the wall clock does', () => {
    let wall = 5_000;
    const clock = createClock(A, null, () => wall);
    const first = clock.send();
    wall = 1_000;
    expect(clock.send() > first).toBe(true);
  });

  it('moves past a timestamp received from a device whose clock runs ahead', () => {
    const ahead = createClock(B, null, () => 90_000).send();
    const clock = createClock(A, null, () => 1_000);
    clock.recv(ahead);
    expect(clock.send() > ahead).toBe(true);
  });

  it('resumes from a saved timestamp', () => {
    const saved = createClock(A, null, () => 50_000).send();
    const clock = createClock(A, saved, () => 10);
    expect(clock.send() > saved).toBe(true);
  });

  it('borrows the next millisecond instead of overflowing the counter', () => {
    const clock = createClock(A, null, () => 1_000);
    let last;
    for (let i = 0; i < 0x10001; i++) last = clock.send();
    expect(parseHlc(last).millis).toBe(1_001);
  });
});
