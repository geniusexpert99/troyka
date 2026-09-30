(function () {
  'use strict';
  const { SIZE, KINDS, adjacent, swap, findMatches, hasMoves, createBoard, collapse } = GemCore;
  const boardElement = document.getElementById('board');
  const boardFrameElement = document.getElementById('board-frame');
  const sparkCanvas = document.getElementById('sparkles');
  const sparkContext = sparkCanvas.getContext('2d');
  const layer = document.getElementById('tiles');
  const scoreElement = document.getElementById('score');
  const statusElement = document.getElementById('status');
  const cascadeElement = document.getElementById('cascade');
  const cheerElement = document.getElementById('cheer');
  const soundButton = document.getElementById('sound-toggle');
  const stageLabel = document.getElementById('stage-label');
  const stageGoal = document.getElementById('stage-goal');
  const stageTrack = document.getElementById('stage-track');
  const stageFill = document.getElementById('stage-fill');
  const stageProgress = document.querySelector('.level-progress');
  const startScreen = document.getElementById('start-screen');
  const gameScreen = document.getElementById('game-screen');
  const endScreen = document.getElementById('end-screen');
  const playButton = document.getElementById('play-game');
  const replayButton = document.getElementById('play-again');
  const homeButton = document.getElementById('go-home');
  const bestStartElement = document.getElementById('best-start');
  const finalScoreElement = document.getElementById('final-score');
  const recordNoteElement = document.getElementById('record-note');
  const newButton = document.getElementById('new-game');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const names = ['Розовый ромб', 'Зелёный квадрат', 'Синий треугольник', 'Жёлтый шестиугольник', 'Фиолетовый кристалл', 'Оранжевый круг', 'Красный круглый рубин'];
  const palettes = [
    ['#f45b9e','#ffb4d1','#d12f77'], ['#43d69d','#a7f5cd','#149b72'],
    ['#58baff','#bee7ff','#2d79d4'], ['#f6cf5c','#fff0ac','#cf942b'],
    ['#aa87f4','#e1cbff','#7450c4'], ['#fb9660','#ffdab2','#d15a33'],
    ['#ed4656','#ffb5bb','#a91d35']
  ];
  const formatter = new Intl.NumberFormat('ru-RU');
  const stages = [
    { name: 'Лунный грот', goal: 300 }, { name: 'Сад самоцветов', goal: 750 },
    { name: 'Звёздный зал', goal: 1400 }, { name: 'Сокровищница', goal: 2300 },
    { name: 'Сердце кристалла', goal: 3500 }, { name: 'Мастер кристаллов', goal: 5000 }
  ];
  let board = [], score = 0, selected = null, busy = false, epoch = 0, nextId = 0, focusIndex = 0, stageIndex = 0;
  let bestScore = readBestScore(), newRecord = false, activeScreen = startScreen, screenTransitionId = 0;
  let soundEnabled = readSoundPreference(), audioContext = null, masterGain = null, sfxBus = null, musicBus = null;
  let musicTimer = 0, musicStep = 0, cheerTimer = 0;
  const nodes = new Map();
  const recycledNodes = [], animations = new Set();
  const screens = [startScreen, gameScreen, endScreen];
  let particles = [], sparkFrame = 0, particleWidth = 0, particleHeight = 0;
  let renderedSelection = null, renderedFocus = null;
  let hasStarted = false;
  const makeTile = value => ({ id: ++nextId, kind: value });
  const randomTile = () => makeTile(Math.floor(Math.random() * KINDS));
  const delay = ms => new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? 16 : ms));
  const position = (col, row) => `translate3d(${col * 100}%,${row * 100}%,0)`;

  // The browser compositor owns movement. Logic waits for the actual animation,
  // and a restart cancels it rather than letting old timeouts update a new board.
  function animate(node, frames, duration, easing = 'cubic-bezier(.22,.7,.3,1)') {
    if (reducedMotion.matches || !node.animate) return delay(duration);
    const animation = node.animate(frames, { duration, easing });
    animations.add(animation);
    return animation.finished.catch(() => {}).then(() => {
      animations.delete(animation); animation.cancel();
    });
  }
  function cancelAnimations() {
    animations.forEach(animation => animation.cancel()); animations.clear();
    screenTransitionId++;
    screens.forEach(screen => {
      screen.hidden = screen !== activeScreen;
      screen.inert = screen !== activeScreen;
      if (screen === activeScreen) screen.removeAttribute('aria-hidden');
      else screen.setAttribute('aria-hidden', 'true');
      screen.style.opacity = '';
      screen.classList.remove('screen-transitioning');
    });
  }

  function readSoundPreference() {
    try { return localStorage.getItem('gem-match-sound') !== 'off'; } catch (_) { return true; }
  }
  function readBestScore() {
    try {
      const value = Number(localStorage.getItem('gem-match-best')) || 0;
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    } catch (_) { return 0; }
  }
  function updateBestDisplays() {
    const best = formatter.format(bestScore);
    bestStartElement.textContent = `Лучший результат: ${best}`;
    finalScoreElement.textContent = formatter.format(score);
    recordNoteElement.textContent = newRecord ? `✦ Новый рекорд — ${best} очков!` : `Лучший результат: ${best}`;
    recordNoteElement.classList.toggle('record-new', newRecord);
  }
  function saveBestIfNeeded() {
    if (score <= bestScore) return false;
    bestScore = score; newRecord = true;
    try { localStorage.setItem('gem-match-best', String(bestScore)); } catch (_) { /* The current run remains playable without storage. */ }
    updateBestDisplays();
    return true;
  }
  function showScreen(nextScreen) {
    if (activeScreen === nextScreen) return;
    cancelAnimations();
    const previous = activeScreen;
    const transitionId = ++screenTransitionId;
    previous.inert = true; previous.setAttribute('aria-hidden', 'true');
    nextScreen.hidden = false; nextScreen.inert = true; nextScreen.removeAttribute('aria-hidden');
    nextScreen.style.opacity = '.001';
    previous.classList.add('screen-transitioning'); nextScreen.classList.add('screen-transitioning');
    activeScreen = nextScreen;
    // A fixed grid footprint keeps the shell still. Two frames prepare its texture
    // before the crossfade; no animated height, layout reads or whole-screen blur.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (transitionId !== screenTransitionId) return;
        nextScreen.style.opacity = ''; previous.style.opacity = '0';
        const outgoing = animate(previous, [{ opacity: 1, transform: 'translate3d(0,0,0)' }, { opacity: 0, transform: 'translate3d(0,-6px,0)' }], 180);
        const incoming = animate(nextScreen, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], 300);
        outgoing.then(() => {
          if (transitionId !== screenTransitionId) return;
          previous.hidden = true; previous.style.opacity = ''; previous.classList.remove('screen-transitioning');
        });
        incoming.then(() => {
          if (transitionId !== screenTransitionId) return;
          nextScreen.inert = false; nextScreen.classList.remove('screen-transitioning');
          const focusTarget = nextScreen === startScreen ? playButton : nextScreen === gameScreen ? nodes.get(board[focusIndex]?.id) : replayButton;
          focusTarget?.focus({ preventScroll: true });
        });
      });
    });
  }
  function createAudio() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return false;
    try {
      audioContext = new Audio();
      masterGain = audioContext.createGain(); masterGain.gain.value = 0;
      sfxBus = audioContext.createGain(); sfxBus.gain.value = 1; sfxBus.connect(masterGain);
      musicBus = audioContext.createGain(); musicBus.gain.value = 0; musicBus.connect(masterGain);
      masterGain.connect(audioContext.destination);
      return true;
    } catch (_) { audioContext = null; return false; }
  }
  function tone(frequency, options = {}) {
    if (!soundEnabled || !audioContext) return;
    const { duration = .16, volume = .04, delaySeconds = 0, wave = 'sine', endFrequency, bus = sfxBus } = options;
    if (audioContext.state !== 'running') {
      audioContext.resume().then(() => tone(frequency, options)).catch(() => {});
      return;
    }
    const start = audioContext.currentTime + delaySeconds;
    const oscillator = audioContext.createOscillator(), envelope = audioContext.createGain();
    oscillator.type = wave; oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + .014);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(envelope); envelope.connect(bus);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(start); oscillator.stop(start + duration + .02);
  }
  function beginMusic() {
    if (!audioContext || !soundEnabled || musicTimer) return;
    musicBus.gain.setTargetAtTime(.42, audioContext.currentTime, .65);
    // Keep the ambience melodic and intermittent; sustained tones created an audible low drone.
    const notes = [392, 523.25, 659.25, 587.33, 523.25, 440, 392, 329.63];
    const playNote = () => {
      tone(notes[musicStep++ % notes.length], { duration: 1.05, volume: .027, wave: 'sine', bus: musicBus });
    };
    playNote(); musicTimer = window.setInterval(playNote, 2450);
  }
  function primeAudio() {
    if (!soundEnabled) return;
    if (!audioContext && !createAudio()) return;
    audioContext.resume().then(() => {
      if (!soundEnabled) return;
      masterGain.gain.setTargetAtTime(.48, audioContext.currentTime, .08);
      beginMusic();
    }).catch(() => {});
  }
  function updateSoundButton() {
    const label = soundEnabled ? 'Выключить звук' : 'Включить звук';
    soundButton.setAttribute('aria-pressed', String(soundEnabled));
    soundButton.setAttribute('aria-label', label); soundButton.title = label;
    soundButton.querySelector('.sr-only').textContent = label;
  }
  function setSoundEnabled(enabled) {
    soundEnabled = enabled;
    try { localStorage.setItem('gem-match-sound', enabled ? 'on' : 'off'); } catch (_) { /* Audio still works if storage is unavailable. */ }
    updateSoundButton();
    if (enabled) primeAudio();
    else {
      if (audioContext && masterGain) masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .08);
      window.clearInterval(musicTimer); musicTimer = 0;
      window.setTimeout(() => {
        if (!soundEnabled && audioContext?.state === 'running') audioContext.suspend().catch(() => {});
      }, 220);
    }
  }
  function playSelect() {
    tone(720, { duration: .075, volume: .027, wave: 'sine' });
    tone(1080, { duration: .09, volume: .012, delaySeconds: .018, wave: 'sine' });
  }
  function playSwap() {
    tone(390, { duration: .11, volume: .026, wave: 'triangle', endFrequency: 510 });
    tone(570, { duration: .13, volume: .018, delaySeconds: .055, wave: 'sine' });
  }
  function playInvalid() {
    tone(290, { duration: .18, volume: .022, wave: 'sine', endFrequency: 225 });
  }
  function playMatch(chain) {
    const base = chain >= 4 ? 659.25 : chain === 3 ? 587.33 : chain === 2 ? 554.37 : 523.25;
    const intervals = chain >= 4 ? [1, 1.25, 1.5, 2] : [1, 1.25, 1.5];
    intervals.forEach((ratio, index) => tone(base * ratio, { duration: .24 + Math.min(chain, 4) * .025, volume: .052, delaySeconds: index * .055, wave: 'sine' }));
    if (chain >= 2) tone(base * 2, { duration: .34, volume: .025, delaySeconds: .08, wave: 'triangle' });
  }
  function playStageUp() {
    [659.25, 783.99, 1046.5].forEach((frequency, index) => tone(frequency, { duration: .3, volume: .045, delaySeconds: index * .085, wave: 'sine' }));
  }
  function showCheer(message) {
    window.clearTimeout(cheerTimer);
    cheerElement.textContent = message; cheerElement.classList.add('visible');
    void animate(cheerElement, [{ opacity: 0, transform: 'translate3d(0,6px,0) scale(.96)' }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }], 220);
    cheerTimer = window.setTimeout(() => { cheerElement.classList.remove('visible'); cheerElement.textContent = ''; }, 1250);
  }
  function updateStageProgress() {
    let advanced = false;
    while (stageIndex < stages.length - 1 && score >= stages[stageIndex].goal) { stageIndex++; advanced = true; }
    const current = stages[stageIndex], previous = stageIndex ? stages[stageIndex - 1].goal : 0;
    stageLabel.textContent = `ЭТАП ${stageIndex + 1} · ${current.name.toLocaleUpperCase('ru-RU')}`;
    if (current.goal === null) {
      stageGoal.textContent = 'Все этапы открыты'; stageTrack.setAttribute('aria-valuemax', '1'); stageTrack.setAttribute('aria-valuenow', '1'); stageFill.style.transform = 'scaleX(1)';
    } else {
      stageGoal.textContent = `${stageIndex === stages.length - 1 ? 'Финиш' : 'Цель'}: ${formatter.format(current.goal)}`;
      stageTrack.setAttribute('aria-valuemax', String(current.goal - previous));
      stageTrack.setAttribute('aria-valuenow', String(Math.max(0, Math.min(current.goal - previous, score - previous))));
      stageFill.style.transform = `scaleX(${Math.max(0, Math.min(1, (score - previous) / (current.goal - previous)))})`;
    }
    if (advanced) {
      stageProgress.classList.add('level-up');
      window.setTimeout(() => stageProgress.classList.remove('level-up'), 650);
    }
    return advanced;
  }

  function clearParticles() {
    particles = [];
    if (sparkFrame) cancelAnimationFrame(sparkFrame);
    sparkFrame = 0;
    sparkContext.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height);
  }
  function resizeParticleCanvas(width, height) {
    if (!sparkContext || width <= 0 || height <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const pixelsWide = Math.round(width * ratio), pixelsHigh = Math.round(height * ratio);
    particleWidth = width; particleHeight = height;
    if (sparkCanvas.width === pixelsWide && sparkCanvas.height === pixelsHigh) return;
    clearParticles();
    sparkCanvas.width = pixelsWide; sparkCanvas.height = pixelsHigh;
    sparkContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  if (window.ResizeObserver) {
    new window.ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      resizeParticleCanvas(width, height);
    }).observe(boardElement);
  } else {
    const measureCanvas = () => {
      const { width, height } = boardElement.getBoundingClientRect();
      resizeParticleCanvas(width, height);
    };
    window.addEventListener('resize', measureCanvas);
    requestAnimationFrame(measureCanvas);
  }
  function burst(matches, chain) {
    if (reducedMotion.matches || !sparkContext || !particleWidth) return;
    const cell = particleWidth / SIZE, matchedIndices = [...matches];
    const count = Math.min(matches.size * (chain > 1 ? 6 : 4), 48);
    for (let n = 0; n < count; n++) {
      const index = matchedIndices[n % matchedIndices.length];
      const tile = board[index];
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * (chain > 1 ? 115 : 85);
      const light = palettes[tile.kind][1];
      particles.push({
        x: (index % SIZE + .5) * cell, y: (Math.floor(index / SIZE) + .5) * cell,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 24,
        life: 280 + Math.random() * 180, maxLife: 460, size: 1.5 + Math.random() * (chain > 1 ? 3.3 : 2.5),
        rotation: Math.random() * Math.PI, spin: (Math.random() - .5) * 7,
        color: n % 5 === 0 ? '#fff4cf' : light, ray: n % 3 !== 1
      });
    }
    if (particles.length > 96) particles.splice(0, particles.length - 96);
    if (!sparkFrame) {
      let previous = performance.now();
      const draw = now => {
        const dt = Math.min((now - previous) / 1000, .04); previous = now;
        sparkContext.clearRect(0, 0, particleWidth, particleHeight);
        let alive = 0;
        for (const p of particles) {
          p.life -= dt * 1000;
          if (p.life <= 0) continue;
          p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 115 * dt; p.rotation += p.spin * dt;
          const fade = Math.min(1, p.life / 100);
          sparkContext.save(); sparkContext.globalAlpha = fade * Math.min(1, p.life / 50);
          sparkContext.translate(p.x, p.y); sparkContext.rotate(p.rotation);
          sparkContext.fillStyle = p.color;
          if (p.ray) {
            const s = p.size;
            sparkContext.beginPath(); sparkContext.moveTo(0, -s * 1.8); sparkContext.lineTo(s * .42, -s * .4);
            sparkContext.lineTo(s * 1.8, 0); sparkContext.lineTo(s * .42, s * .4);
            sparkContext.lineTo(0, s * 1.8); sparkContext.lineTo(-s * .42, s * .4);
            sparkContext.lineTo(-s * 1.8, 0); sparkContext.lineTo(-s * .42, -s * .4); sparkContext.closePath();
            sparkContext.fill();
          } else { sparkContext.beginPath(); sparkContext.arc(0, 0, p.size * .62, 0, Math.PI * 2); sparkContext.fill(); }
          sparkContext.restore(); particles[alive++] = p;
        }
        particles.length = alive;
        if (particles.length) sparkFrame = requestAnimationFrame(draw);
        else { sparkFrame = 0; sparkContext.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height); }
      };
      sparkFrame = requestAnimationFrame(draw);
    }
  }

  function setBusy(value) {
    busy = value;
    boardElement.classList.toggle('busy', value);
    boardElement.setAttribute('aria-busy', String(value));
    nodes.forEach(node => node.setAttribute('aria-disabled', String(value)));
  }
  function syncSelection() {
    const nextSelection = selected === null ? null : board[selected]?.id;
    const nextFocus = board[focusIndex]?.id;
    if (renderedSelection !== nextSelection) {
      const old = nodes.get(renderedSelection), next = nodes.get(nextSelection);
      old?.classList.remove('selected'); old?.setAttribute('aria-pressed', 'false');
      next?.classList.add('selected'); next?.setAttribute('aria-pressed', 'true');
      renderedSelection = nextSelection;
    }
    if (renderedFocus !== nextFocus) {
      const old = nodes.get(renderedFocus), next = nodes.get(nextFocus);
      if (old) old.tabIndex = -1;
      if (next) next.tabIndex = 0;
      renderedFocus = nextFocus;
    }
  }
  function render(starts, duration = 0) {
    const ids = new Set(board.filter(Boolean).map(tile => tile.id)), moving = [];
    nodes.forEach((node, id) => {
      if (!ids.has(id)) { node.remove(); nodes.delete(id); recycledNodes.push(node); }
    });
    board.forEach((tile, index) => {
      if (!tile) return;
      let node = nodes.get(tile.id);
      const isNew = !node, oldIndex = node ? Number(node.dataset.index) : index;
      const to = position(index % SIZE, Math.floor(index / SIZE));
      const from = starts?.has(tile.id) ? position(index % SIZE, starts.get(tile.id)) : position(oldIndex % SIZE, Math.floor(oldIndex / SIZE));
      if (isNew) {
        node = recycledNodes.pop() || document.createElement('button');
        node.className = 'tile'; node.type = 'button';
        node.classList.remove('selected', 'clearing', 'swapping', 'reversing');
        node.innerHTML = `<span class="gem" style="background-position:${tile.kind * 100 / (KINDS - 1)}% 0" aria-hidden="true"></span>`;
        node.dataset.kind = String(tile.kind);
        node.style.opacity = ''; node.tabIndex = -1;
        node.setAttribute('aria-pressed', 'false');
        node.setAttribute('aria-disabled', String(busy));
        layer.appendChild(node); nodes.set(tile.id, node);
      }
      // Stable nodes and cached indices keep unchanged stones out of the write path.
      if (isNew || oldIndex !== index) {
        node.dataset.index = String(index);
        node.setAttribute('aria-label', `${names[tile.kind]}, строка ${Math.floor(index / SIZE) + 1}, столбец ${index % SIZE + 1}`);
      }
      if (isNew || from !== to) node.style.transform = to;
      if (duration && from !== to) {
        const frames = isNew ? [{ transform: from, opacity: 0 }, { opacity: 1, offset: .22 }, { transform: to, opacity: 1 }] : [{ transform: from }, { transform: to }];
        moving.push(animate(node, frames, duration));
      }
    });
    syncSelection();
    const formattedScore = formatter.format(score);
    if (scoreElement.textContent !== formattedScore) scoreElement.textContent = formattedScore;
    return Promise.all(moving);
  }
  function newGame() {
    epoch++;
    gameScreen.classList.remove('screen-warm');
    cancelAnimations();
    if (hasStarted) board = createBoard().map(makeTile);
    hasStarted = true;
    score = 0; selected = null; focusIndex = 0; stageIndex = 0; newRecord = false;
    renderedSelection = null; renderedFocus = null;
    clearParticles();
    delete boardFrameElement.dataset.chain;
    window.clearTimeout(cheerTimer); cheerElement.classList.remove('visible'); cheerElement.textContent = '';
    updateStageProgress();
    setBusy(false);
    statusElement.textContent = 'Выберите два соседних самоцвета';
    cascadeElement.textContent = '';
    render();
    updateBestDisplays();
    primeAudio();
    showScreen(gameScreen);
  }
  function finishGame() {
    finalScoreElement.textContent = formatter.format(score);
    recordNoteElement.textContent = newRecord ? `✦ Новый рекорд — ${formatter.format(bestScore)} очков!` : `Лучший результат: ${formatter.format(bestScore)}`;
    recordNoteElement.classList.toggle('record-new', newRecord);
    statusElement.textContent = 'Все этапы пройдены!';
    setBusy(false);
    playStageUp();
    tone(1318.51, { duration: .52, volume: .055, delaySeconds: .2, wave: 'sine' });
    showScreen(endScreen);
  }
  async function resolveMatches(token, matches) {
    let chain = 0;
    while (matches.size && token === epoch) {
      chain++;
      const points = matches.size * 10;
      score += points;
      scoreElement.textContent = formatter.format(score);
      saveBestIfNeeded();
      const unlocked = updateStageProgress();
      playMatch(chain);
      const cheer = ['Отлично!', 'Супер!', 'Каскад!', 'Невероятно!'][Math.min(chain - 1, 3)];
      showCheer(unlocked ? `Новый этап: ${stages[stageIndex].name}!` : cheer);
      if (unlocked) playStageUp();
      statusElement.textContent = `+${points} очков · собрано ${matches.size}`;
      cascadeElement.textContent = chain > 1 ? `Каскад ×${chain}` : '';
      boardFrameElement.dataset.chain = String(Math.min(chain, 4));
      cascadeElement.dataset.chain = String(Math.min(chain, 4));
      burst(matches, chain);
      const clearing = [...matches].map(index => {
        const node = nodes.get(board[index].id), at = position(index % SIZE, Math.floor(index / SIZE));
        node.classList.add('clearing'); node.style.opacity = '0';
        return animate(node, [{ transform: at, opacity: 1 }, { transform: `${at} scale(1.18)`, opacity: 1, offset: .28 }, { transform: `${at} scale(.12) rotate(16deg)`, opacity: 0 }], 270);
      });
      await Promise.all(clearing);
      if (token !== epoch) return;
      const result = collapse(board, matches, randomTile);
      board = result.board;
      const starts = new Map(result.movements.map(move => [move.tile.id, move.fromRow]));
      await render(starts, 300);
      if (token !== epoch) return;
      matches = findMatches(board);
    }
    if (token !== epoch) return;
    if (score >= stages[stages.length - 1].goal) { finishGame(); return; }
    if (!hasMoves(board)) {
      statusElement.textContent = 'Ходов нет — перемешиваем поле';
      await delay(650);
      if (token !== epoch) return;
      board = createBoard().map(makeTile);
      render();
      statusElement.textContent = 'Поле обновлено. Счёт сохранён';
    } else {
      statusElement.textContent = 'Выберите два соседних самоцвета';
    }
    cascadeElement.textContent = '';
    delete cascadeElement.dataset.chain;
    delete boardFrameElement.dataset.chain;
    setBusy(false);
  }
  async function attemptSwap(a, b) {
    if (busy || !adjacent(a, b)) return { accepted: false, reason: 'Ход недоступен' };
    const token = epoch;
    selected = null;
    setBusy(true);
    statusElement.textContent = 'Проверяем комбинацию…';
    playSwap();
    board = swap(board, a, b);
    nodes.get(board[a].id)?.classList.add('swapping');
    nodes.get(board[b].id)?.classList.add('swapping');
    await render(undefined, 200);
    if (token !== epoch) return { accepted: false, reason: 'Начата новая игра' };
    nodes.get(board[a].id)?.classList.remove('swapping');
    nodes.get(board[b].id)?.classList.remove('swapping');
    const matches = findMatches(board);
    if (!matches.size) {
      nodes.get(board[a].id)?.classList.add('reversing');
      nodes.get(board[b].id)?.classList.add('reversing');
      board = swap(board, a, b);
      statusElement.textContent = 'Нет комбинации — попробуйте другой ход';
      playInvalid();
      await render(undefined, 200);
      if (token !== epoch) return { accepted: false, reason: 'Начата новая игра' };
      nodes.forEach(node => node.classList.remove('reversing'));
      setBusy(false);
      return { accepted: false, reason: 'Нет комбинации', score };
    }
    await resolveMatches(token, matches);
    return token === epoch ? { accepted: true, score } : { accepted: false, reason: 'Начата новая игра' };
  }
  function choose(index) {
    if (busy) return;
    primeAudio();
    focusIndex = index;
    if (selected === index) selected = null;
    else if (selected !== null && adjacent(selected, index)) { void attemptSwap(selected, index); return; }
    else { selected = index; playSelect(); }
    statusElement.textContent = selected === null ? 'Выберите два соседних самоцвета' : 'Теперь выберите соседний самоцвет';
    syncSelection();
  }
  // Native button click supports mouse, touch, Enter and Space without duplicate pointer events.
  layer.addEventListener('click', event => {
    const tile = event.target.closest('.tile');
    if (tile) choose(Number(tile.dataset.index));
  });
  layer.addEventListener('keydown', event => {
    const tile = event.target.closest('.tile');
    if (!tile || busy) return;
    const index = Number(tile.dataset.index), row = Math.floor(index / SIZE), col = index % SIZE;
    const destinations = { ArrowLeft: row * SIZE + Math.max(0, col - 1), ArrowRight: row * SIZE + Math.min(7, col + 1), ArrowUp: Math.max(0, row - 1) * SIZE + col, ArrowDown: Math.min(7, row + 1) * SIZE + col };
    if (event.key in destinations) {
      event.preventDefault(); focusIndex = destinations[event.key]; syncSelection();
      nodes.get(board[focusIndex].id).focus({ preventScroll: true });
    } else if (event.key === 'Escape') { selected = null; syncSelection(); statusElement.textContent = 'Выберите два соседних самоцвета'; }
  });
  newButton.addEventListener('click', newGame);
  playButton.addEventListener('click', newGame);
  replayButton.addEventListener('click', newGame);
  homeButton.addEventListener('click', () => showScreen(startScreen));
  soundButton.addEventListener('click', () => setSoundEnabled(!soundEnabled));
  updateSoundButton();
  document.getElementById('cells').replaceChildren(...Array.from({ length: 64 }, () => {
    const cell = document.createElement('div'); cell.className = 'cell'; return cell;
  }));
  board = createBoard().map(makeTile);
  render(); updateStageProgress(); updateBestDisplays(); setBusy(false);
  // Prepare the board's compositor layers while the player reads the title card.
  // The first play uses this already prepared board instead of rebuilding it.
  requestAnimationFrame(() => {
    if (activeScreen !== startScreen) return;
    gameScreen.classList.add('screen-warm');
  });

  // Optional browser-standard tools use exactly the same actions as the visible controls.
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifecycle = new AbortController();
    const state = () => ({ board: board.map(tile => tile.kind), size: SIZE, score, bestScore, busy, stage: stageIndex + 1, soundEnabled, screen: activeScreen.id });
    const definitions = [
      { name: 'read_game', description: 'Read the current 8×8 board (row-major gem kinds 0–6), score and busy state.', annotations: { readOnlyHint: true, untrustedContentHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: state },
      { name: 'start_new_game', description: 'Start a fresh game immediately, replacing the board and resetting the score.', annotations: { readOnlyHint: false, untrustedContentHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute() { newGame(); return state(); } },
      { name: 'swap_gems', description: 'Swap two adjacent gems at row-major indices 0–63, and wait for rollback or all cascades to finish.', annotations: { readOnlyHint: false, untrustedContentHint: false }, inputSchema: { type: 'object', properties: { first: { type: 'integer', minimum: 0, maximum: 63 }, second: { type: 'integer', minimum: 0, maximum: 63 } }, required: ['first', 'second'], additionalProperties: false }, execute(input) { if (!input || !adjacent(input.first, input.second)) throw new Error('Выберите два соседних самоцвета с индексами 0–63'); if (busy) throw new Error('Дождитесь завершения текущего хода'); return attemptSwap(input.first, input.second); } }
    ];
    for (const tool of definitions) {
      try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch (_) { /* Play remains available if optional registration is unsupported. */ }
    }
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  }
})();
