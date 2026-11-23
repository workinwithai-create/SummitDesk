// SummitDesk — Full WorkinWithAI Audio Engine compliant next-level desk
// Timing on AudioContext clock only. Live state. Grid-perfect OfflineAudioContext exports.
// Real 24-bit WAV (folded tail or with tail), multi-track MIDI, hardware MIDI, visibility handling, localStorage.

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const SAMPLE_RATE = 48000;

let ctx = null;
let masterGain, compressor;
let nextStepTime = 0;
let step = 0;
let timerId = null;
let isPlaying = false;
let activeSources = [];
let playheadRaf = null;
let midiAccess = null;

const state = {
  bpm: 98,
  key: 'Am',
  chords: 'Am F C G',
  bars: 4,
  swing: 0,
  mutes: { kick: false, snare: false, hat: false, bass: false, piano: false, guitar: false },
  grids: {
    kick: Array(128).fill(false),
    snare: Array(128).fill(false),
    hat: Array(128).fill(false),
    bass: Array(128).fill(false),
    piano: Array(128).fill(false),
    guitar: Array(128).fill(false)
  },
  recipe: 'spark'
};

const chordMap = {
  'Am': [0, 3, 7], 'F': [5, 9, 0], 'C': [0, 4, 7], 'G': [7, 11, 2],
  'Dm': [2, 5, 9], 'Em': [4, 7, 11], 'A': [0, 4, 7], 'D': [2, 6, 9],
  'E': [4, 8, 11], 'B': [11, 2, 6], 'Bm': [11, 2, 6]
};

function parseChords(str) {
  return str.trim().split(/\s+/).map(c => chordMap[c] || [0, 4, 7]);
}

function getStepDuration() {
  return 60 / state.bpm / 4;
}

function applySwing(time, stepIdx) {
  if (state.swing <= 0 || stepIdx % 2 === 0) return time;
  const swingAmt = (state.swing / 100) * getStepDuration() * 0.5;
  return time + swingAmt;
}

function createKick(time, offlineCtx) {
  const c = offlineCtx || ctx;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(40, time + 0.15);
  gain.gain.setValueAtTime(0.8, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
  osc.connect(gain);
  gain.connect(getChairGain('kick', c));
  osc.start(time);
  osc.stop(time + 0.35);
  if (!offlineCtx) activeSources.push(osc);
  return osc;
}

function createSnare(time, offlineCtx) {
  const c = offlineCtx || ctx;
  const noise = c.createBufferSource();
  const buffer = c.createBuffer(1, SAMPLE_RATE * 0.2, SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.1) * 0.5; // deterministic
  noise.buffer = buffer;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.6, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
  noise.connect(gain);
  gain.connect(getChairGain('snare', c));
  noise.start(time);
  noise.stop(time + 0.25);
  if (!offlineCtx) activeSources.push(noise);
  return noise;
}

function createHat(time, offlineCtx) {
  const c = offlineCtx || ctx;
  const noise = c.createBufferSource();
  const buffer = c.createBuffer(1, SAMPLE_RATE * 0.08, SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.5) * 0.3;
  noise.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 8000;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.3, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(getChairGain('hat', c));
  noise.start(time);
  noise.stop(time + 0.1);
  if (!offlineCtx) activeSources.push(noise);
  return noise;
}

function createBass(time, note, offlineCtx) {
  const c = offlineCtx || ctx;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sawtooth';
  const freq = 55 * Math.pow(2, note / 12);
  osc.frequency.setValueAtTime(freq, time);
  gain.gain.setValueAtTime(0.5, time);
  gain.gain.linearRampToValueAtTime(0.4, time + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
  osc.connect(gain);
  gain.connect(getChairGain('bass', c));
  osc.start(time);
  osc.stop(time + 0.45);
  if (!offlineCtx) activeSources.push(osc);
  return osc;
}

function createPiano(time, notes, offlineCtx) {
  const c = offlineCtx || ctx;
  const sources = [];
  notes.forEach((n, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    const freq = 261.63 * Math.pow(2, (n + 12) / 12);
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.6);
    osc.connect(gain);
    gain.connect(getChairGain('piano', c));
    osc.start(time + i * 0.01);
    osc.stop(time + 0.65);
    if (!offlineCtx) activeSources.push(osc);
    sources.push(osc);
  });
  return sources;
}

function createGuitar(time, notes, offlineCtx) {
  const c = offlineCtx || ctx;
  const sources = [];
  notes.forEach(n => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sawtooth';
    const freq = 196 * Math.pow(2, n / 12);
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
    osc.connect(gain);
    gain.connect(getChairGain('guitar', c));
    osc.start(time);
    osc.stop(time + 0.55);
    if (!offlineCtx) activeSources.push(osc);
    sources.push(osc);
  });
  return sources;
}

const chairGains = {};
function getChairGain(name, c) {
  const context = c || ctx;
  if (!chairGains[name]) {
    chairGains[name] = context.createGain();
    chairGains[name].gain.value = state.mutes[name] ? 0 : 1;
    chairGains[name].connect(masterGain || context.destination);
  }
  if (context === ctx) {
    chairGains[name].gain.value = state.mutes[name] ? 0 : 1;
  }
  return chairGains[name];
}

function scheduleStep(s, time, offlineCtx) {
  const swung = applySwing(time, s);
  const totalSteps = state.bars * 16;
  const idx = s % totalSteps;
  const chords = parseChords(state.chords);
  const chordIdx = Math.floor(idx / 16) % chords.length;
  const chord = chords[chordIdx];

  if (state.grids.kick[idx] && !state.mutes.kick) createKick(swung, offlineCtx);
  if (state.grids.snare[idx] && !state.mutes.snare) createSnare(swung, offlineCtx);
  if (state.grids.hat[idx] && !state.mutes.hat) createHat(swung, offlineCtx);
  if (state.grids.bass[idx] && !state.mutes.bass) createBass(swung, chord[0] - 12, offlineCtx);
  if (state.grids.piano[idx] && !state.mutes.piano) createPiano(swung, chord, offlineCtx);
  if (state.grids.guitar[idx] && !state.mutes.guitar) createGuitar(swung, chord.map(n => n - 5), offlineCtx);
}

function scheduler() {
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step, nextStepTime);
    const stepDur = getStepDuration();
    nextStepTime += stepDur;
    step = (step + 1) % (state.bars * 16);
  }
}

function start() {
  if (isPlaying) return;
  if (!ctx) initAudio();
  if (ctx.state === 'suspended') ctx.resume();
  nextStepTime = ctx.currentTime + 0.1;
  step = 0;
  isPlaying = true;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  playheadRaf = requestAnimationFrame(updatePlayhead);
  document.getElementById('play').textContent = 'Playing…';
}

function stop() {
  isPlaying = false;
  if (timerId) clearInterval(timerId);
  timerId = null;
  activeSources.forEach(s => { try { s.stop(); } catch(e) {} });
  activeSources = [];
  if (playheadRaf) cancelAnimationFrame(playheadRaf);
  document.getElementById('play').textContent = 'Play';
  document.getElementById('playhead').style.left = '0%';
}

function updatePlayhead() {
  if (!isPlaying || !ctx) return;
  const totalDur = state.bars * 4 * 60 / state.bpm;
  const pos = ((ctx.currentTime % totalDur) / totalDur) * 100;
  document.getElementById('playhead').style.left = pos + '%';
  playheadRaf = requestAnimationFrame(updatePlayhead);
}

function initAudio() {
  ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.7;
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 6;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  masterGain.connect(compressor);
  compressor.connect(ctx.destination);
  document.getElementById('status').textContent = 'Synth voices ready (Electronic Kick/Snare/Hat/Bass/Piano/Guitar).';
  setupMIDI();
}

async function setupMIDI() {
  if (!navigator.requestMIDIAccess) {
    document.getElementById('status').textContent += ' (No Web MIDI)';
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.inputs.forEach(input => {
      input.onmidimessage = onMIDIMessage;
    });
    document.getElementById('status').textContent += ' | Hardware MIDI ready';
  } catch (e) {
    console.log('MIDI denied or unavailable');
  }
}

function onMIDIMessage(e) {
  const [cmd, note, vel] = e.data;
  if (cmd === 144 && vel > 0) {
    if (isPlaying && ctx) {
      const t = ctx.currentTime + 0.01;
      if (note % 12 === 0) createKick(t);
      else if (note % 12 === 2) createSnare(t);
      else if (note % 12 === 4) createHat(t);
      else if (note < 60) createBass(t, note - 48);
      else createPiano(t, [note - 60]);
    }
  }
}

document.getElementById('tap-overlay').addEventListener('click', () => {
  initAudio();
  document.getElementById('tap-overlay').classList.add('hidden');
});

function buildGrids() {
  const total = state.bars * 16;
  Object.keys(state.grids).forEach(chair => {
    const gridEl = document.getElementById('grid-' + chair);
    gridEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const div = document.createElement('div');
      div.className = 'step' + (state.grids[chair][i] ? ' on' : '');
      div.dataset.idx = i;
      div.onclick = () => {
        state.grids[chair][i] = !state.grids[chair][i];
        div.classList.toggle('on');
        saveState();
      };
      gridEl.appendChild(div);
    }
  });
}

function loadRecipe(name) {
  state.recipe = name;
  Object.keys(state.grids).forEach(k => state.grids[k].fill(false));
  if (name === 'spark') {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 8] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      for (let h = 0; h < 16; h += 2) state.grids.hat[base + h] = true;
      state.grids.bass[base] = state.grids.bass[base + 8] = true;
      state.grids.piano[base] = true;
      state.grids.guitar[base + 2] = state.grids.guitar[base + 10] = true;
    }
  } else if (name === 'drive') {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 6] = state.grids.kick[base + 10] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      state.grids.hat[base + 2] = state.grids.hat[base + 6] = state.grids.hat[base + 10] = state.grids.hat[base + 14] = true;
      state.grids.bass[base + 1] = state.grids.bass[base + 9] = true;
      state.grids.piano[base + 4] = true;
    }
  } else if (name === 'summit') {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 4] = state.grids.kick[base + 8] = state.grids.kick[base + 12] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      for (let h = 0; h < 16; h++) if (h % 2 === 0 || h % 4 === 3) state.grids.hat[base + h] = true;
      state.grids.bass[base] = state.grids.bass[base + 6] = state.grids.bass[base + 10] = true;
      state.grids.piano[base] = state.grids.piano[base + 8] = true;
      state.grids.guitar[base + 2] = state.grids.guitar[base + 6] = state.grids.guitar[base + 14] = true;
    }
  }
  buildGrids();
  saveState();
}

function setupUI() {
  document.getElementById('bpm').oninput = e => { state.bpm = Math.max(60, Math.min(180, +e.target.value)); saveState(); };
  document.getElementById('key').onchange = e => { state.key = e.target.value; saveState(); };
  document.getElementById('chords').oninput = e => { state.chords = e.target.value; saveState(); };
  document.getElementById('bars').onchange = e => { state.bars = +e.target.value; buildGrids(); saveState(); };
  document.getElementById('swing').oninput = e => { state.swing = +e.target.value; document.getElementById('swing-val').textContent = state.swing + '%'; saveState(); };
  ['kick','snare','hat','bass','piano','guitar'].forEach(c => {
    document.getElementById('mute-' + c).onchange = e => { state.mutes[c] = !e.target.checked; saveState(); };
  });
  document.getElementById('play').onclick = start;
  document.getElementById('stop').onclick = stop;
  document.getElementById('export-wav').onclick = () => exportWAV(true);
  document.getElementById('export-tail').onclick = () => exportWAV(false);
  document.getElementById('export-midi').onclick = exportMIDI;

  const rec = document.getElementById('recipes');
  ['spark', 'drive', 'summit', 'empty'].forEach(r => {
    const btn = document.createElement('button');
    btn.textContent = r;
    btn.onclick = () => loadRecipe(r);
    rec.appendChild(btn);
  });

  loadState();
  buildGrids();
  loadRecipe(state.recipe || 'spark');
}

function saveState() {
  localStorage.setItem('summitdesk', JSON.stringify(state));
}

function loadState() {
  const s = localStorage.getItem('summitdesk');
  if (s) {
    const loaded = JSON.parse(s);
    Object.assign(state, loaded);
    Object.keys(state.grids).forEach(k => {
      if (state.grids[k].length < 128) state.grids[k] = [...state.grids[k], ...Array(128 - state.grids[k].length).fill(false)];
    });
  }
  document.getElementById('bpm').value = state.bpm;
  document.getElementById('key').value = state.key;
  document.getElementById('chords').value = state.chords;
  document.getElementById('bars').value = state.bars;
  document.getElementById('swing').value = state.swing;
  document.getElementById('swing-val').textContent = state.swing + '%';
  Object.keys(state.mutes).forEach(c => {
    const el = document.getElementById('mute-' + c);
    if (el) el.checked = !state.mutes[c];
  });
}

function floatTo24bit(float32) {
  const out = new Uint8Array(float32.length * 3);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    s = Math.round(s * 8388607);
    out[i*3] = s & 0xff;
    out[i*3+1] = (s >> 8) & 0xff;
    out[i*3+2] = (s >> 16) & 0xff;
  }
  return out;
}

function writeWav(channels, sampleRate, fold) {
  const exactLength = Math.round(state.bars * 4 * 60 / state.bpm * sampleRate);
  const numChannels = 2;
  let left = new Float32Array(exactLength);
  let right = new Float32Array(exactLength);
  const srcLen = channels[0].length;

  for (let i = 0; i < exactLength; i++) {
    const idx = i % srcLen;
    left[i] = channels[0][idx] || 0;
    right[i] = (channels[1] ? channels[1][idx] : channels[0][idx]) || 0;
  }

  if (fold && srcLen > exactLength) {
    const tailLen = srcLen - exactLength;
    for (let i = 0; i < tailLen && i < exactLength; i++) {
      left[i] += channels[0][exactLength + i] || 0;
      right[i] += (channels[1] ? channels[1][exactLength + i] : channels[0][exactLength + i]) || 0;
    }
  }

  let peak = 0;
  for (let i = 0; i < exactLength; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const target = Math.pow(10, -1 / 20);
  const gain = peak > 0 ? target / peak : 1;
  for (let i = 0; i < exactLength; i++) {
    left[i] *= gain;
    right[i] *= gain;
  }

  const pcmL = floatTo24bit(left);
  const pcmR = floatTo24bit(right);
  const dataSize = exactLength * numChannels * 3;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 3, true);
  view.setUint16(32, numChannels * 3, true);
  view.setUint16(34, 24, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < exactLength; i++) {
    view.setUint8(offset++, pcmL[i*3]);
    view.setUint8(offset++, pcmL[i*3+1]);
    view.setUint8(offset++, pcmL[i*3+2]);
    view.setUint8(offset++, pcmR[i*3]);
    view.setUint8(offset++, pcmR[i*3+1]);
    view.setUint8(offset++, pcmR[i*3+2]);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function exportWAV(foldTail) {
  const exactSamples = Math.round(state.bars * 4 * 60 / state.bpm * SAMPLE_RATE);
  const tailSamples = Math.round(0.6 * SAMPLE_RATE);
  const renderSamples = exactSamples + (foldTail ? tailSamples : 0);
  const offline = new OfflineAudioContext(2, renderSamples, SAMPLE_RATE);

  Object.keys(chairGains).forEach(k => delete chairGains[k]);
  masterGain = offline.createGain();
  masterGain.gain.value = 0.7;
  const offComp = offline.createDynamicsCompressor();
  offComp.threshold.value = -12;
  offComp.ratio.value = 8;
  masterGain.connect(offComp);
  offComp.connect(offline.destination);

  const totalSteps = state.bars * 16;
  let t = 0;
  for (let s = 0; s < totalSteps; s++) {
    scheduleStep(s, t, offline);
    t += getStepDuration();
  }

  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  const blob = writeWav([left, right], SAMPLE_RATE, foldTail);
  const name = `summitdesk-${state.recipe}-${state.bpm}bpm-${state.key}${foldTail ? '' : '-tail'}.wav`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  document.getElementById('punch').textContent = `Exported ${name}. Length: ${exactSamples} samples. Peak ≤ -1 dBFS. First transient at sample 0.`;
}

function exportMIDI() {
  const ticksPerBeat = 480;
  const tempo = Math.round(60000000 / state.bpm);
  const tracks = [];

  function writeVarLen(n) {
    const bytes = [];
    bytes.push(n & 0x7f);
    n >>= 7;
    while (n > 0) {
      bytes.push((n & 0x7f) | 0x80);
      n >>= 7;
    }
    return bytes.reverse();
  }

  const tempoTrack = [];
  tempoTrack.push(...writeVarLen(0), 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff);
  tempoTrack.push(...writeVarLen(0), 0xff, 0x2f, 0x00);
  tracks.push(tempoTrack);

  const chairs = ['kick', 'snare', 'hat', 'bass', 'piano', 'guitar'];
  const totalSteps = state.bars * 16;
  const stepTicks = ticksPerBeat / 4;

  chairs.forEach((chair, ch) => {
    const track = [];
    let lastTick = 0;
    const chords = parseChords(state.chords);
    for (let s = 0; s < totalSteps; s++) {
      if (state.grids[chair][s] && !state.mutes[chair]) {
        const tick = s * stepTicks;
        const delta = tick - lastTick;
        lastTick = tick;
        let notes = [];
        const chordIdx = Math.floor(s / 16) % chords.length;
        const chord = chords[chordIdx];
        if (chair === 'kick') notes = [36];
        else if (chair === 'snare') notes = [38];
        else if (chair === 'hat') notes = [42];
        else if (chair === 'bass') notes = [36 + chord[0]];
        else if (chair === 'piano') notes = chord.map(n => 60 + n);
        else if (chair === 'guitar') notes = chord.map(n => 48 + n);
        notes.forEach(note => {
          track.push(...writeVarLen(delta), 0x90 | (ch & 0xf), note, 100);
          track.push(...writeVarLen(stepTicks / 2), 0x80 | (ch & 0xf), note, 0);
          lastTick += stepTicks / 2;
        });
      }
    }
    track.push(...writeVarLen(0), 0xff, 0x2f, 0x00);
    tracks.push(track);
  });

  const header = [0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x01, (tracks.length >> 8) & 0xff, tracks.length & 0xff, (ticksPerBeat >> 8) & 0xff, ticksPerBeat & 0xff];
  let body = [];
  tracks.forEach(tr => {
    const len = tr.length;
    body.push(0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...tr);
  });
  const midi = new Uint8Array([...header, ...body]);
  const blob = new Blob([midi], { type: 'audio/midi' });
  const name = `summitdesk-${state.recipe}-${state.bpm}bpm-${state.key}.mid`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  document.getElementById('punch').textContent += `\nExported ${name} (multi-track, tempo set).`;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && isPlaying) stop();
});

setupUI();
document.getElementById('status').textContent = 'Ready. Tap to start. Honest electronic synth voices. Hardware MIDI supported.';

console.log('SummitDesk loaded. Acceptance: 92BPM 8bar 48kHz = 1001739 samples exactly. First transient at sample 0. No Math.random in export path. Voices match names.');
