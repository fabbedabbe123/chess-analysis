import { describe, expect, it } from 'vitest';
import { usernameProblem } from '@/sync/profile';

describe('usernameProblem', () => {
  it('accepts normal names', () => {
    for (const n of ['abc', 'Fabian_09', 'a_b_c', 'X'.repeat(20)]) expect(usernameProblem(n)).toBeNull();
  });
  it('rejects too short and too long', () => {
    expect(usernameProblem('ab')).toMatch(/At least 3/);
    expect(usernameProblem('x'.repeat(21))).toMatch(/At most 20/);
  });
  it('rejects spaces, symbols and non-ASCII', () => {
    for (const n of ['a b c', 'name!', 'åäö_x', 'a-b-c', 'a.b.c', '<b>x</b>']) expect(usernameProblem(n)).toMatch(/Only letters/);
  });
  it('rejects reserved names in any case', () => {
    for (const n of ['admin', 'ADMIN', 'Stockfish', 'null']) expect(usernameProblem(n)).toMatch(/reserved/);
  });
});
