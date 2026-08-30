import { generateInviteCode, isInviteCode } from './invite-code';

const ALLOWED = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

describe('generateInviteCode', () => {
  it('produces a 10-character code', () => {
    expect(generateInviteCode()).toHaveLength(10);
  });

  it('draws only from the unambiguous alphabet', () => {
    // 500 codes is 5,000 characters -- enough that a stray `0`/`O`/`1`/`I`/`L`
    // leaking in from a mis-typed alphabet would show up.
    for (let i = 0; i < 500; i += 1) {
      for (const character of generateInviteCode()) {
        expect(ALLOWED).toContain(character);
      }
    }
  });

  it('gives 10,000 draws 10,000 distinct codes', () => {
    const codes = new Set<string>();

    for (let i = 0; i < 10_000; i += 1) codes.add(generateInviteCode());

    // A constant or seeded generator collapses this set; a real one at ~49
    // bits of entropy has a vanishing chance of a collision in 10,000 draws.
    expect(codes.size).toBe(10_000);
  });

  it('spreads draws across the whole alphabet rather than favouring its start', () => {
    // The regression this guards is `byte % 31` without rejection sampling,
    // which over-picks the first 256 % 31 = 8 characters by ~12%. With 31,000
    // characters drawn, every character should appear ~1,000 times; a biased
    // generator pushes the head of the alphabet well past this ceiling.
    const counts = new Map<string, number>();

    for (let i = 0; i < 3_100; i += 1) {
      for (const character of generateInviteCode()) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }

    expect(counts.size).toBe(ALLOWED.length);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1_200);
    }
  });
});

describe('isInviteCode', () => {
  it('accepts what the generator produces', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(isInviteCode(generateInviteCode())).toBe(true);
    }
  });

  it.each([
    ['too short', 'ABCDEFGHJ'],
    ['too long', 'ABCDEFGHJK2'],
    ['empty', ''],
    ['an excluded digit zero', 'ABCDEFGHJ0'],
    ['an excluded letter O', 'ABCDEFGHJO'],
    ['an excluded letter I', 'ABCDEFGHJI'],
    ['an excluded letter L', 'ABCDEFGHJL'],
    ['an excluded digit one', 'ABCDEFGHJ1'],
    ['lowercase', 'abcdefghjk'],
    ['a hyphen', 'ABCDEFGH-K'],
  ])('rejects %s', (_label, value) => {
    expect(isInviteCode(value)).toBe(false);
  });
});
