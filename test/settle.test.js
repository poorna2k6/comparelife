import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, settle } from '../src/settle.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);

test('allocate always sums exactly', () => {
  for (const [amt, w] of [[100, [1, 1, 1]], [1, [5, 3]], [999, [7, 11, 13]], [0, [1]], [50, [0, 0]]]) {
    const out = allocate(amt, w);
    assert.equal(sum(out), sum(w) === 0 ? 0 : amt);
  }
});

test('forfeited stakes go to qualifiers pro rata by achievement', () => {
  // top=100, cutoff 50% -> c(30) and d(10) lose. Pot 4*1000, forfeited 2000.
  const r = settle({ stake: 1000, cutoff: 50, members: [
    { id: 'a', total: 100 }, { id: 'b', total: 50 }, { id: 'c', total: 30 }, { id: 'd', total: 10 },
  ] });
  const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
  assert.equal(r.forfeited, 2000);
  assert.equal(by.a.bonus, 1333); // 2000 * 100/150, remainder rule
  assert.equal(by.b.bonus, 667);
  assert.equal(by.c.payout, 0);
  assert.equal(by.c.net, -1000);
  assert.equal(sum(r.results.map((x) => x.payout)), r.pot); // money conserved
});

test('exactly at the cutoff stays in', () => {
  const r = settle({ stake: 500, cutoff: 50, members: [{ id: 'a', total: 200 }, { id: 'b', total: 100 }] });
  assert.ok(r.results.find((x) => x.id === 'b').qualified);
  assert.equal(r.forfeited, 0);
});

test('everyone at zero -> full refund', () => {
  const r = settle({ stake: 500, cutoff: 80, members: [{ id: 'a', total: 0 }, { id: 'b', total: 0 }] });
  assert.deepEqual(r.results.map((x) => x.payout), [500, 500]);
});

test('equal mode splits evenly', () => {
  const r = settle({ stake: 900, cutoff: 50, mode: 'equal', members: [
    { id: 'a', total: 100 }, { id: 'b', total: 60 }, { id: 'c', total: 1 },
  ] });
  assert.deepEqual(r.results.map((x) => x.bonus), [450, 450, 0]);
});

test('solo participant gets their stake back', () => {
  const r = settle({ stake: 700, cutoff: 90, members: [{ id: 'a', total: 5 }] });
  assert.equal(r.results[0].payout, 700);
});

test('cutoff 0 means nobody can lose', () => {
  const r = settle({ stake: 100, cutoff: 0, members: [{ id: 'a', total: 100 }, { id: 'b', total: 0 }] });
  assert.equal(r.forfeited, 0);
});
