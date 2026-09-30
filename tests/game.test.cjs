'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const core = require('../dist/core.js');

// A small DOM/timer harness exercises the real controller without real-time waits.
function boot({ storage = {}, startImmediately = true, reducedMotion = true } = {}) {
  const metrics = { layoutReads: 0, attributeWrites: 0, buttonsCreated: 0 }, animationCalls = [];
  class Element {
    constructor() {
      this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.listeners = {};
      const classes = new Set();
      this.hidden = false; this.inert = false; this.scrollHeight = 500;
      this.classList = {
        add: (...values) => values.forEach(value => classes.add(value)),
        remove: (...values) => values.forEach(value => classes.delete(value)),
        contains: value => classes.has(value),
        toggle(value, on) { if (on) classes.add(value); else classes.delete(value); return classes.has(value); }
      };
    }
    appendChild(child) { child.parent = this; this.children.push(child); }
    replaceChildren(...children) { this.children = []; for (const child of children) this.appendChild(child); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute(key, value) { metrics.attributeWrites++; this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    focus() {}
    closest() { return this; }
    getContext() { return context2d; }
    getBoundingClientRect() { metrics.layoutReads++; return { width: 300, height: this.id === 'board' ? 300 : 500 }; }
    get offsetHeight() { metrics.layoutReads++; return 1; }
    querySelector() { return new Element(); }
    animate(frames, options) {
      let complete, fail;
      const call = { node:this, frames, ...options, cancelled:false, done:false };
      animationCalls.push(call);
      const finished = new Promise((resolve,reject) => { complete = resolve; fail = reject; });
      timers.push(() => { if (!call.cancelled) { call.done = true; complete(); } });
      return { finished, cancel() { call.cancelled = true; if (!call.done) fail(new Error('Animation cancelled')); } };
    }
  }
  const context2d = { clearRect() {}, setTransform() {}, save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, arc() {}, set fillStyle(_) {}, set globalAlpha(_) {} };
  const ids = ['board','board-frame','sparkles','tiles','cells','score','status','cascade','cheer','sound-toggle','stage-label','stage-goal','stage-track','stage-fill','new-game','screen-container','start-screen','game-screen','end-screen','play-game','play-again','go-home','best-start','final-score','record-note'];
  const elements = Object.fromEntries(ids.map(id => [id,new Element()]));
  for (const id of ['start-screen','game-screen','end-screen']) elements[id].id = id;
  elements['game-screen'].hidden = true; elements['game-screen'].inert = true;
  elements['end-screen'].hidden = true; elements['end-screen'].inert = true;
  const progress = new Element();
  const audio = { oscillators: 0, frequencies: [], activeOscillators: 0 };
  class FakeAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() { audio.oscillators++; return { frequency: { value: 0, setValueAtTime(value) { audio.frequencies.push(value); }, exponentialRampToValueAtTime() {} }, connect() {}, start() { audio.activeOscillators++; }, stop() { audio.activeOscillators--; } }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  const tools = new Map(), timers = []; let seed = 42, frameTime = 0;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const math = Object.create(Math); math.random = random;
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/game.js'), 'utf8'), {
    GemCore: core, Math: math, Intl, AbortController, performance: { now: () => frameTime },
    localStorage: { getItem: key => storage[key] ?? null, setItem: (key,value) => { storage[key] = String(value); } },
    window: {
      matchMedia: () => ({ matches:reducedMotion }), addEventListener() {}, setTimeout: callback => { timers.push(callback); return timers.length; },
      clearTimeout() {}, setInterval: () => 1, clearInterval() {}, AudioContext: FakeAudioContext
    },
    document: { getElementById: id => elements[id], querySelector: () => progress, createElement: tag => { if (tag === 'button') metrics.buttonsCreated++; return new Element(); }, modelContext: { registerTool(tool) { tools.set(tool.name,tool); } } },
    setTimeout: callback => { timers.push(callback); return timers.length; }, requestAnimationFrame: callback => { timers.push(() => { frameTime += 16; callback(frameTime); }); return timers.length; }, cancelAnimationFrame() {}
  });
  const state = () => tools.get('read_game').execute();
  const click = index => elements.tiles.listeners.click({ target: elements.tiles.children.find(el => Number(el.dataset.index) === index) });
  async function drain() {
    for (let i = 0; i < 1000; i++) {
      for (let j = 0; j < 6; j++) await Promise.resolve();
      if (!timers.length) return;
      timers.shift()();
    }
    throw new Error('Controller failed to settle');
  }
  async function advanceUntil(predicate) {
    for (let i = 0; i < 1000; i++) {
      for (let j = 0; j < 6; j++) await Promise.resolve();
      if (predicate()) return;
      if (timers.length) timers.shift()();
    }
    throw new Error('Expected animation phase was not reached');
  }
  if (startImmediately) {
    elements['play-game'].listeners.click();
    while (timers.length) timers.shift()();
  }
  return { elements, tools, state, click, drain, advanceUntil, timers, storage, audio, metrics, animationCalls };
}

test('real click handler selects, deselects and reselects non-neighbours', () => {
  const game = boot();
  assert.equal(game.elements.tiles.children.length,64);
  game.click(0); assert.equal(game.elements.tiles.children[0].attributes['aria-pressed'],'true');
  game.click(0); assert.equal(game.elements.tiles.children[0].attributes['aria-pressed'],'false');
  game.click(0); game.click(63);
  assert.equal(game.elements.tiles.children[0].attributes['aria-pressed'],'false');
  assert.equal(game.elements.tiles.children[63].attributes['aria-pressed'],'true');
  assert.equal(game.state().busy,false);
});
test('clicking an invalid swap rolls back without changing score or gems', async () => {
  const game = boot({ reducedMotion:false }), before = game.state().board.slice();
  let pair;
  for (let a = 0; a < 64 && !pair; a++) for (const b of [a+1,a+8]) {
    if (core.adjacent(a,b) && !core.findMatches(core.swap(before,a,b)).size) { pair = [a,b]; break; }
  }
  game.click(pair[0]); game.click(pair[1]);
  assert.equal(game.state().busy,true);
  game.click(63); // Input during animation cannot start another turn.
  await game.drain();
  assert.deepEqual(game.state().board,before);
  assert.equal(game.state().score,0); assert.equal(game.state().busy,false);
  assert.ok(game.audio.frequencies.includes(290));
});
test('legal moves settle all cascades, leave 64 gems and accumulate score', async () => {
  const game = boot({ reducedMotion:false });
  for (let turn = 0; turn < 30; turn++) {
    const before = game.state(), [a,b] = core.findMoves(before.board)[0];
    const action = game.tools.get('swap_gems').execute({ first:a, second:b });
    await game.drain();
    const result = await action, after = game.state();
    assert.equal(result.accepted,true);
    assert.ok(after.score >= before.score + 30);
    assert.equal(after.busy,false); assert.equal(after.board.length,64);
    assert.equal(core.findMatches(after.board).size,0);
    assert.ok(core.findMoves(after.board).length);
    assert.equal(game.elements.tiles.children.length,64);
  }
});
test('new game during swap, clearing or falling cancels animations and resets the board', async () => {
  for (const phase of ['swap','clearing','falling']) {
    const game = boot({ reducedMotion:false });
    await game.drain();
    const [a,b] = core.findMoves(game.state().board)[0];
    const action = game.tools.get('swap_gems').execute({ first:a,second:b });
    if (phase === 'clearing') {
      await game.advanceUntil(() => game.state().score > 0);
      assert.ok(game.state().score > 0);
    }
    if (phase === 'falling') await game.advanceUntil(() => game.animationCalls.some(call => call.node.className === 'tile' && call.duration === 300 && !call.done));
    game.elements['new-game'].listeners.click();
    const restarted = game.state().board.slice();
    await game.drain(); await action;
    assert.deepEqual(game.state().board,restarted);
    assert.equal(game.state().score,0); assert.equal(game.state().busy,false);
    assert.equal(game.elements.tiles.children.length,64);
    assert.equal(game.elements['game-screen'].inert,false);
    assert.ok(game.elements.tiles.children.every(node => node.style.opacity === ''));
  }
});

test('a restart during the screen transition leaves one interactive game screen', async () => {
  const game = boot({ reducedMotion:false, startImmediately:false });
  game.elements['play-game'].listeners.click();
  game.tools.get('start_new_game').execute();
  await game.drain();
  assert.equal(game.elements['game-screen'].hidden,false);
  assert.equal(game.elements['game-screen'].inert,false);
  assert.equal(game.elements['start-screen'].hidden,true);
  assert.equal(game.elements['end-screen'].hidden,true);
});

test('animated play reuses 64 buttons and does not force layout during selection or cascades', async () => {
  const game = boot({ reducedMotion:false });
  await game.drain();
  const reads = game.metrics.layoutReads, writes = game.metrics.attributeWrites;
  const buttons = game.elements.tiles.children.slice();
  game.click(0);
  assert.ok(game.metrics.attributeWrites - writes <= 2);
  assert.deepEqual(game.elements.tiles.children,buttons);
  const [a,b] = core.findMoves(game.state().board)[0];
  const action = game.tools.get('swap_gems').execute({ first:a, second:b });
  await game.drain(); await action;
  game.elements['new-game'].listeners.click();
  await game.drain();
  assert.equal(game.metrics.buttonsCreated,64);
  assert.equal(game.metrics.layoutReads,reads);
  assert.ok(game.animationCalls.length > 0);
  for (const call of game.animationCalls) {
    for (const frame of call.frames) assert.ok(Object.keys(frame).every(key => ['transform','opacity','offset'].includes(key)));
  }
});
test('structured swap rejects a diagonal without modifying state', () => {
  const game = boot(), before = game.state().board.slice();
  assert.throws(() => game.tools.get('swap_gems').execute({ first:0,second:9 }), /соседних/);
  assert.deepEqual(game.state().board,before);
});

test('the landing screen starts a fresh game and the return button restores it', async () => {
  const game = boot({ startImmediately:false });
  assert.equal(game.state().screen,'start-screen');
  assert.equal(game.elements['game-screen'].hidden,true);
  game.elements['play-game'].listeners.click();
  assert.equal(game.state().screen,'game-screen');
  assert.equal(game.state().score,0);
  await game.drain();
  game.elements['go-home'].listeners.click();
  assert.equal(game.state().screen,'start-screen');
  await game.drain();
  assert.equal(game.elements['game-screen'].hidden,true);
});

test('sound toggle reacts, persists across reloads and can be turned back on without a sustained audio drone', () => {
  const storage = {}, first = boot({ storage });
  const before = first.audio.oscillators;
  first.click(0);
  assert.ok(first.audio.oscillators > before);
  assert.ok(first.audio.frequencies.includes(720));
  assert.equal(first.audio.activeOscillators,0,'ambient notes and effects should all be short sounds');
  first.elements['sound-toggle'].listeners.click();
  assert.equal(first.state().soundEnabled,false);
  assert.equal(storage['gem-match-sound'],'off');
  const second = boot({ storage, startImmediately:false });
  assert.equal(second.state().soundEnabled,false);
  assert.equal(second.elements['sound-toggle'].attributes['aria-pressed'],'false');
  second.elements['sound-toggle'].listeners.click();
  assert.equal(second.state().soundEnabled,true);
  assert.equal(storage['gem-match-sound'],'on');
});

test('a successful move plays a different swap sound and a bright match cue', async () => {
  const game = boot(), [first,second] = core.findMoves(game.state().board)[0];
  game.click(first); game.click(second);
  await game.drain();
  assert.ok(game.audio.frequencies.includes(390));
  assert.ok(game.audio.frequencies.includes(523.25));
  assert.ok(game.state().score > 0);
});

test('a full run unlocks every stage, saves a record and shows the final screen', async () => {
  const storage = {}, game = boot({ storage });
  for (let turn = 0; turn < 300 && game.state().screen !== 'end-screen'; turn++) {
    const before = game.state(), [first,second] = core.findMoves(before.board)[0];
    const action = game.tools.get('swap_gems').execute({ first, second });
    await game.drain();
    const result = await action;
    assert.equal(result.accepted,true);
  }
  const finished = game.state();
  assert.equal(finished.screen,'end-screen');
  assert.ok(finished.score >= 5000);
  assert.equal(finished.stage,6);
  assert.equal(finished.bestScore,finished.score);
  assert.ok(game.audio.frequencies.includes(1046.5));
  assert.equal(storage['gem-match-best'],String(finished.score));
  assert.equal(game.elements['final-score'].textContent,new Intl.NumberFormat('ru-RU').format(finished.score));
  assert.match(game.elements['record-note'].textContent,/Новый рекорд/);

  game.elements['play-again'].listeners.click();
  assert.equal(game.state().screen,'game-screen');
  assert.equal(game.state().score,0);
  assert.equal(game.state().bestScore,finished.score);
  await game.drain();
  game.elements['go-home'].listeners.click();
  await game.drain();
  assert.equal(game.elements['best-start'].textContent,`Лучший результат: ${new Intl.NumberFormat('ru-RU').format(finished.score)}`);
  const reloaded = boot({ storage, startImmediately:false });
  assert.equal(reloaded.state().bestScore,finished.score);
  assert.equal(reloaded.elements['best-start'].textContent,game.elements['best-start'].textContent);
});
