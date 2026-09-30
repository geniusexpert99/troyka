/* Pure game rules; shared by the browser and the mechanics tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GemCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SIZE = 8;
  const KINDS = 7;
  const kind = tile => tile === null ? null : typeof tile === 'object' ? tile.kind : tile;
  function adjacent(a, b) {
    return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < 64 && b < 64 &&
      Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) + Math.abs(a % SIZE - b % SIZE) === 1;
  }
  function swap(board, a, b) {
    const result = board.slice();
    [result[a], result[b]] = [result[b], result[a]];
    return result;
  }
  function findMatches(board) {
    const matches = new Set();
    for (const vertical of [false, true]) {
      for (let line = 0; line < SIZE; line++) {
        let start = 0;
        const index = offset => vertical ? offset * SIZE + line : line * SIZE + offset;
        while (start < SIZE) {
          const value = kind(board[index(start)]);
          let end = start + 1;
          while (end < SIZE && kind(board[index(end)]) === value) end++;
          if (value !== null && end - start >= 3) {
            for (let offset = start; offset < end; offset++) matches.add(index(offset));
          }
          start = end;
        }
      }
    }
    return matches;
  }
  function moveMakesMatch(board, a, b) {
    if (kind(board[a]) === kind(board[b])) return false;
    const at = index => kind(board[index === a ? b : index === b ? a : index]);
    for (const index of [a, b]) {
      const value = at(index);
      if (value === null) continue;
      const row = Math.floor(index / SIZE), col = index % SIZE;
      for (const [step, before, after] of [[1, col, SIZE - col - 1], [SIZE, row, SIZE - row - 1]]) {
        let count = 1;
        for (let d = 1; d <= before && at(index - d * step) === value; d++) count++;
        for (let d = 1; d <= after && at(index + d * step) === value; d++) count++;
        if (count >= 3) return true;
      }
    }
    return false;
  }
  function findMoves(board) {
    const moves = [];
    for (let a = 0; a < board.length; a++) {
      for (const b of [a + 1, a + SIZE]) {
        if (adjacent(a, b) && moveMakesMatch(board, a, b)) moves.push([a, b]);
      }
    }
    return moves;
  }
  function hasMoves(board) {
    for (let a = 0; a < board.length; a++) {
      for (const b of [a + 1, a + SIZE]) {
        if (adjacent(a, b) && moveMakesMatch(board, a, b)) return true;
      }
    }
    return false;
  }
  function createBoard(random = Math.random) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const board = [];
      for (let i = 0; i < SIZE * SIZE; i++) {
        const excluded = new Set();
        if (i % SIZE >= 2 && board[i - 1] === board[i - 2]) excluded.add(board[i - 1]);
        if (i >= 2 * SIZE && board[i - SIZE] === board[i - 2 * SIZE]) excluded.add(board[i - SIZE]);
        const options = Array.from({ length: KINDS }, (_, k) => k).filter(k => !excluded.has(k));
        board.push(options[Math.min(options.length - 1, Math.max(0, Math.floor(random() * options.length)))]);
      }
      if (hasMoves(board)) return board;
    }
    // Deterministic fallback also handles a degenerate random source.
    const board = Array.from({ length: 64 }, (_, i) => (Math.floor(i / SIZE) * 2 + i % SIZE) % KINDS);
    board[0] = 0; board[1] = 1; board[2] = 0; board[9] = 0;
    return board;
  }
  function collapse(board, matches, createTile) {
    const result = Array(64).fill(null);
    const movements = [];
    for (let col = 0; col < SIZE; col++) {
      let destination = SIZE - 1;
      for (let row = SIZE - 1; row >= 0; row--) {
        const from = row * SIZE + col;
        if (matches.has(from) || board[from] === null) continue;
        const to = destination * SIZE + col;
        result[to] = board[from];
        movements.push({ tile: board[from], fromRow: row, toRow: destination, col });
        destination--;
      }
      const missing = destination + 1;
      for (let row = 0; row < missing; row++) {
        const tile = createTile();
        result[row * SIZE + col] = tile;
        movements.push({ tile, fromRow: row - missing, toRow: row, col });
      }
    }
    return { board: result, movements };
  }
  return Object.freeze({ SIZE, KINDS, adjacent, swap, findMatches, findMoves, hasMoves, createBoard, collapse });
});
