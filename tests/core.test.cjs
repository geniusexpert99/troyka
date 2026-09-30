'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.js');
const patterned = () => Array.from({ length: 64 }, (_, i) => (Math.floor(i / 8) * 2 + i % 8) % core.KINDS);
const sorted = set => [...set].sort((a, b) => a - b);
function seeded(seed) { return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }; }

test('adjacency accepts only horizontal/vertical neighbours inside the board', () => {
  for (const pair of [[0,1],[0,8],[63,62],[63,55]]) assert.equal(core.adjacent(...pair), true);
  for (const pair of [[7,8],[0,9],[0,0],[-1,0],[63,64],[0,1.5]]) assert.equal(core.adjacent(...pair), false);
});
test('horizontal runs of 3, 4, 5 and 8 are fully matched', () => {
  for (const count of [3,4,5,8]) {
    const board = Array(64).fill(null);
    for (let i = 0; i < count; i++) board[24 + i] = 5;
    assert.deepEqual(sorted(core.findMatches(board)), Array.from({ length: count }, (_, i) => 24 + i));
  }
});
test('vertical runs are found and horizontal lines never wrap', () => {
  const board = patterned();
  for (let r = 0; r < 5; r++) board[r * 8 + 4] = 1;
  assert.deepEqual(sorted(core.findMatches(board)), [4,12,20,28,36]);
  const wrapped = patterned(); wrapped[7] = wrapped[8] = wrapped[9] = 5;
  assert.equal(core.findMatches(wrapped).size, 0);
});
test('crossing matches count the shared gemstone once; empty cells do not match', () => {
  const board = Array(64).fill(null);
  for (const i of [19,26,27,28,35]) board[i] = 4;
  assert.deepEqual(sorted(core.findMatches(board)), [19,26,27,28,35]);
});
test('swap does not mutate its input and rollback restores the board', () => {
  const board = patterned(), original = board.slice();
  const exchanged = core.swap(board, 0, 1);
  assert.deepEqual(board, original);
  assert.deepEqual(core.swap(exchanged, 0, 1), original);
});
test('generated boards have 64 valid gems, no ready matches and at least one move', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const board = core.createBoard(seeded(seed));
    assert.equal(board.length, 64);
    assert.ok(board.every(k => Number.isInteger(k) && k >= 0 && k < core.KINDS));
    assert.equal(core.findMatches(board).size, 0);
    assert.ok(core.findMoves(board).length > 0);
  }
  for (const value of [0,0.999999]) {
    const board = core.createBoard(() => value);
    assert.equal(core.findMatches(board).size, 0);
    assert.ok(core.findMoves(board).length > 0);
  }
});
test('gravity keeps surviving stones in order and fills the top of each column', () => {
  const board = patterned().map((kind, id) => ({ kind, id }));
  const removed = new Set([0,16,40,57]); let id = 64;
  const result = core.collapse(board, removed, () => ({ kind: 2, id: id++ }));
  assert.equal(result.board.length, 64); assert.ok(result.board.every(Boolean));
  assert.deepEqual(Array.from({ length: 8 }, (_, r) => result.board[r * 8].id), [64,65,66,8,24,32,48,56]);
  assert.equal(result.board[9].id, 1);
  assert.equal(result.board[57].id, 49);
  assert.equal(result.movements.filter(move => move.fromRow < 0).length, 4);
  for (let i = 0; i < 64; i++) if (i % 8 > 1) assert.equal(result.board[i], board[i]);
});
test('refilled gems trigger the next cascade, and all cascades settle', () => {
  let board = patterned(); board[56] = board[57] = board[58] = 0;
  let matches = core.findMatches(board);
  assert.deepEqual(sorted(matches), [56,57,58]);
  board = core.collapse(board, matches, () => 3).board;
  matches = core.findMatches(board);
  assert.deepEqual(sorted(matches), [0,1,2,3]);
  const random = seeded(42); let passes = 1, points = 30;
  while (matches.size && passes < 100) {
    points += matches.size * 10;
    board = core.collapse(board, matches, () => Math.floor(random() * core.KINDS)).board;
    matches = core.findMatches(board); passes++;
  }
  assert.ok(passes >= 2 && passes < 100);
  assert.ok(points >= 70); assert.equal(matches.size, 0);
});
test('a dead board has no moves; every listed legal move creates a local match', () => {
  assert.equal(core.findMoves(patterned()).length, 0);
  assert.equal(core.hasMoves(patterned()), false);
  const board = core.createBoard(seeded(8));
  for (const [a,b] of core.findMoves(board)) {
    assert.ok(core.adjacent(a,b));
    const matches = core.findMatches(core.swap(board,a,b));
    assert.ok(matches.has(a) || matches.has(b));
  }
});
test('local move detection agrees with exhaustive matching for every adjacent swap', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const board = core.createBoard(seeded(seed)), expected = [];
    for (let a = 0; a < 64; a++) for (const b of [a + 1, a + 8]) {
      if (!core.adjacent(a,b) || board[a] === board[b]) continue;
      const matches = core.findMatches(core.swap(board,a,b));
      if (matches.has(a) || matches.has(b)) expected.push([a,b]);
    }
    assert.deepEqual(core.findMoves(board),expected);
    assert.equal(core.hasMoves(board),expected.length > 0);
  }
});
