/* ====================================================
   ASTRIX — OPERATOR DASHBOARD LOGIC
   dashboard.js
   ==================================================== */

'use strict';

// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
const state = {
  ws: null,
  demoMode: true,
  running: false,
  training: false,
  sessionStart: Date.now(),
  hrHistory: [],
  csiBuffer: [],
  sampleCount: 0,
  maxSamples: 1000,
  logEntries: [],
  hrMin: Infinity, hrMax: -Infinity, hrSum: 0, hrCount: 0,
};

// ══════════════════════════════════════════════════════
// DOM REFS
// ══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

const csiCanvas    = $('csi-canvas');
const heatmapCanvas= $('heatmap-canvas');
const hrCanvas     = $('hr-canvas');
const csiCtx       = csiCanvas.getContext('2d');
const hmCtx        = heatmapCanvas.getContext('2d');
const hrCtx        = hrCanvas.getContext('2d');

// ══════════════════════════════════════════════════════
// SESSION TIMER
// ══════════════════════════════════════════════════════
setInterval(() => {
  const elapsed = Math.floor((Date.now() - state.sessionStart) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2,'0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2,'0');
  const s = String(elapsed % 60).padStart(2,'0');
  $('session-time').textContent = `${h}:${m}:${s}`;
}, 1000);

// ══════════════════════════════════════════════════════
// CANVAS RESIZE
// ══════════════════════════════════════════════════════
function resizeCanvases() {
  csiCanvas.width  = csiCanvas.offsetWidth;
  csiCanvas.height = csiCanvas.offsetHeight;
  heatmapCanvas.width = heatmapCanvas.offsetWidth;
  hrCanvas.width = hrCanvas.offsetWidth;
}
window.addEventListener('resize', resizeCanvases);
setTimeout(resizeCanvases, 100);

// ══════════════════════════════════════════════════════
// CSI SIGNAL CANVAS — multi-channel animated waveform
// ══════════════════════════════════════════════════════
const channels = [
  { color: '#00d4ff', amp: 0.28, freq: 0.03, speed: 0.8, phase: 0,   alpha: 0.9 },
  { color: '#0066ff', amp: 0.18, freq: 0.05, speed: 1.3, phase: 1.5, alpha: 0.6 },
  { color: '#00ff88', amp: 0.10, freq: 0.08, speed: 2.0, phase: 3.0, alpha: 0.4 },
  { color: '#ff3366', amp: 0.06, freq: 0.12, speed: 1.6, phase: 1.0, alpha: 0.25 },
];

let csiT = 0;
let stressAmplifier = 1.0; // increases when "lie" detected

function drawCSI() {
  const W = csiCanvas.width, H = csiCanvas.height;
  if (!W || !H) { requestAnimationFrame(drawCSI); return; }

  csiCtx.clearRect(0, 0, W, H);

  // Grid lines
  csiCtx.strokeStyle = 'rgba(0,128,255,0.06)';
  csiCtx.lineWidth = 1;
  for (let y = 0; y <= 4; y++) {
    const yp = H * (y / 4);
    csiCtx.beginPath(); csiCtx.moveTo(0, yp); csiCtx.lineTo(W, yp); csiCtx.stroke();
  }

  // Center line
  csiCtx.strokeStyle = 'rgba(0,128,255,0.15)';
  csiCtx.beginPath(); csiCtx.moveTo(0, H/2); csiCtx.lineTo(W, H/2); csiCtx.stroke();

  channels.forEach(ch => {
    csiCtx.beginPath();
    const grad = csiCtx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.1, ch.color);
    grad.addColorStop(0.9, ch.color);
    grad.addColorStop(1, 'transparent');
    csiCtx.strokeStyle = grad;
    csiCtx.lineWidth = ch === channels[0] ? 2 : 1.2;
    csiCtx.globalAlpha = ch.alpha;

    for (let x = 0; x <= W; x += 2) {
      const t = x / W;
      const amp = H/2 * ch.amp * stressAmplifier;
      const y = H/2
        + amp * Math.sin(ch.freq * W * t + csiT * ch.speed + ch.phase)
        + amp * 0.4 * Math.sin(ch.freq * 1.7 * W * t - csiT * ch.speed * 0.6 + ch.phase + 1);
      x === 0 ? csiCtx.moveTo(x, y) : csiCtx.lineTo(x, y);
    }
    csiCtx.stroke();
  });

  csiCtx.globalAlpha = 1;
  csiT += 0.04;
  requestAnimationFrame(drawCSI);
}
drawCSI();

// ══════════════════════════════════════════════════════
// HEATMAP CANVAS — subcarrier amplitude
// ══════════════════════════════════════════════════════
const SUBCARRIERS = 64;
let subAmps = new Float32Array(SUBCARRIERS).fill(0.5);

function drawHeatmap() {
  const W = heatmapCanvas.width, H = heatmapCanvas.height || 48;
  if (!W) { requestAnimationFrame(drawHeatmap); return; }

  hmCtx.clearRect(0, 0, W, H);
  const cellW = W / SUBCARRIERS;

  // Update amps
  for (let i = 0; i < SUBCARRIERS; i++) {
    subAmps[i] += (Math.random() - 0.5) * 0.06;
    subAmps[i] = Math.max(0.05, Math.min(0.95, subAmps[i]));
  }

  for (let i = 0; i < SUBCARRIERS; i++) {
    const v = subAmps[i];
    // cyan → blue → purple based on amplitude
    const r = Math.round(v * 80);
    const g = Math.round(v * 200);
    const b = 255;
    hmCtx.fillStyle = `rgba(${r},${g},${b},${0.5 + v * 0.5})`;
    hmCtx.fillRect(i * cellW, 0, cellW - 1, H);
  }
  setTimeout(drawHeatmap, 80);
}
drawHeatmap();

// ══════════════════════════════════════════════════════
// HR CANVAS — rolling trend line
// ══════════════════════════════════════════════════════
function drawHRTrend() {
  const W = hrCanvas.width, H = hrCanvas.height || 80;
  if (!W) { setTimeout(drawHRTrend, 100); return; }

  hrCtx.clearRect(0, 0, W, H);
  const hist = state.hrHistory;
  if (hist.length < 2) { setTimeout(drawHRTrend, 200); return; }

  const min = Math.min(...hist) - 5;
  const max = Math.max(...hist) + 5;
  const range = max - min || 1;

  // Area fill
  const grad = hrCtx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(0,255,136,0.25)');
  grad.addColorStop(1, 'rgba(0,255,136,0)');

  hrCtx.beginPath();
  hist.forEach((v, i) => {
    const x = (i / (hist.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    i === 0 ? hrCtx.moveTo(x, y) : hrCtx.lineTo(x, y);
  });
  hrCtx.lineTo(W, H); hrCtx.lineTo(0, H); hrCtx.closePath();
  hrCtx.fillStyle = grad;
  hrCtx.fill();

  // Line
  hrCtx.beginPath();
  hrCtx.strokeStyle = '#00ff88';
  hrCtx.lineWidth = 2;
  hrCtx.lineJoin = 'round';
  hist.forEach((v, i) => {
    const x = (i / (hist.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    i === 0 ? hrCtx.moveTo(x, y) : hrCtx.lineTo(x, y);
  });
  hrCtx.stroke();
  setTimeout(drawHRTrend, 200);
}
drawHRTrend();

// ══════════════════════════════════════════════════════
// DETECTION ENGINE — update UI
// ══════════════════════════════════════════════════════
function updateDetection(data) {
  const { stress, deception, resp, motion, confidence, verdict } = data;

  // Ring
  const ringFill = $('ring-fill');
  const circumference = 515;
  const offset = circumference - (confidence / 100) * circumference;
  ringFill.style.strokeDashoffset = offset;

  // Ring color by verdict
  if (verdict === 'DECEPTION') {
    ringFill.style.stroke = '#ff3366';
    $('verdict-ring').style.filter = 'drop-shadow(0 0 16px rgba(255,51,102,0.5))';
  } else if (verdict === 'STRESS') {
    ringFill.style.stroke = '#ffbb00';
    $('verdict-ring').style.filter = 'drop-shadow(0 0 16px rgba(255,187,0,0.4))';
  } else {
    ringFill.style.stroke = '#00d4ff';
    $('verdict-ring').style.filter = 'drop-shadow(0 0 12px rgba(0,212,255,0.3))';
  }

  $('verdict-label').textContent = verdict;
  $('verdict-pct').textContent = confidence + '%';

  // Bars
  $('fill-stress').style.width    = stress + '%';
  $('fill-deception').style.width = deception + '%';
  $('fill-resp').style.width      = resp + '%';
  $('fill-motion').style.width    = motion + '%';

  $('val-stress').textContent    = stress + '%';
  $('val-deception').textContent = deception + '%';
  $('val-resp').textContent      = resp + '%';
  $('val-motion').textContent    = motion + '%';

  stressAmplifier = 1 + (stress / 100) * 0.6;
}

// ══════════════════════════════════════════════════════
// INFERENCE LOG
// ══════════════════════════════════════════════════════
function addLogEntry(verdict, confidence, ts) {
  const entries = $('log-entries');
  const div = document.createElement('div');
  const type = verdict === 'DECEPTION' ? 'lie' : verdict === 'STRESS' ? 'stress' : 'truth';
  div.className = `log-entry log-entry--${type}`;
  div.innerHTML = `<span class="log-ts">${ts}</span><span>${verdict}</span><span>${confidence}% conf.</span>`;
  entries.prepend(div);
  // keep max 50
  while (entries.children.length > 50) entries.lastChild.remove();
}

$('log-clear').addEventListener('click', () => $('log-entries').innerHTML = '');

// ══════════════════════════════════════════════════════
// SYSTEM LOG (bottom bar)
// ══════════════════════════════════════════════════════
function sysLog(msg, type = 'info') {
  const container = $('events');
  const chip = document.createElement('span');
  chip.className = `event-chip event-chip--${type === 'ok' ? 'ok' : type === 'warn' ? 'warn' : type === 'err' ? 'err' : ''}`;
  chip.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  container.prepend(chip);
  while (container.children.length > 8) container.lastChild.remove();
}

// ══════════════════════════════════════════════════════
// HEART RATE — update UI
// ══════════════════════════════════════════════════════
function updateHR(bpm) {
  $('hr-number').textContent = bpm;

  state.hrHistory.push(bpm);
  if (state.hrHistory.length > 120) state.hrHistory.shift();

  if (bpm < state.hrMin) state.hrMin = bpm;
  if (bpm > state.hrMax) state.hrMax = bpm;
  state.hrSum += bpm; state.hrCount++;
  const avg = Math.round(state.hrSum / state.hrCount);
  const hrv = Math.round(Math.random() * 20 + 25); // mock HRV

  $('hr-min').textContent = state.hrMin === Infinity ? '--' : state.hrMin;
  $('hr-max').textContent = state.hrMax === -Infinity ? '--' : state.hrMax;
  $('hr-avg').textContent = avg;
  $('hr-hrv').textContent = hrv + ' ms';

  // Zone
  const zoneDot = $('zone-dot');
  const zoneLabel = $('zone-label');
  if (bpm < 60) {
    zoneDot.style.background = '#0066ff'; zoneLabel.textContent = 'Zone 1 — Resting';
  } else if (bpm < 80) {
    zoneDot.style.background = '#00ff88'; zoneLabel.textContent = 'Zone 2 — Light Activity';
  } else if (bpm < 100) {
    zoneDot.style.background = '#ffbb00'; zoneLabel.textContent = 'Zone 3 — Moderate Stress';
  } else {
    zoneDot.style.background = '#ff3366'; zoneLabel.textContent = 'Zone 4 — High Stress';
  }
}

// ══════════════════════════════════════════════════════
// DEMO MODE — simulate data
// ══════════════════════════════════════════════════════
let demoPhase = 'truth'; // truth | stress | lie
let demoTick = 0;
let demoHR = 72;

function runDemo() {
  if (!state.demoMode) return;

  demoTick++;
  // Switch phases every ~30 ticks
  if (demoTick % 30 === 0) {
    const phases = ['truth', 'truth', 'stress', 'truth', 'lie'];
    demoPhase = phases[Math.floor(Math.random() * phases.length)];
  }

  let stress, deception, resp, motion, confidence, verdict;

  if (demoPhase === 'lie') {
    stress     = randInt(55, 80);
    deception  = randInt(60, 88);
    resp       = randInt(60, 80);
    motion     = randInt(20, 40);
    confidence = randInt(78, 94);
    verdict    = 'DECEPTION';
    demoHR = clamp(demoHR + randInt(-2, 6), 88, 115);
  } else if (demoPhase === 'stress') {
    stress     = randInt(45, 65);
    deception  = randInt(15, 35);
    resp       = randInt(55, 75);
    motion     = randInt(30, 55);
    confidence = randInt(70, 85);
    verdict    = 'STRESS';
    demoHR = clamp(demoHR + randInt(-1, 4), 80, 100);
  } else {
    stress     = randInt(10, 28);
    deception  = randInt(5, 18);
    resp       = randInt(25, 45);
    motion     = randInt(5, 15);
    confidence = randInt(88, 97);
    verdict    = 'TRUTHFUL';
    demoHR = clamp(demoHR + randInt(-3, 2), 60, 80);
  }

  updateDetection({ stress, deception, resp, motion, confidence, verdict });
  updateHR(demoHR);

  // Occasionally add a log entry
  if (demoTick % 8 === 0) {
    const ts = new Date().toLocaleTimeString();
    addLogEntry(verdict, confidence, ts);
  }

  // Update sample count if collecting
  if (state.running) {
    state.sampleCount++;
    const pct = Math.min((state.sampleCount / state.maxSamples) * 100, 100);
    $('progress-fill').style.width = pct + '%';
    $('progress-label').textContent = `${state.sampleCount} / ${state.maxSamples}`;
    $('sample-count').textContent   = `${state.sampleCount} samples`;

    if (state.sampleCount >= state.maxSamples) {
      stopCollection();
    }
  }

  // Randomize meta
  if (demoTick % 5 === 0) {
    $('pkt-rate').textContent = randInt(95, 102);
    $('snr-val').textContent  = (Math.random() * 4 + 22).toFixed(1) + ' dB';
    $('rssi-val').textContent = '−' + randInt(44, 55) + ' dBm';
  }
}

setInterval(runDemo, 600);

// ══════════════════════════════════════════════════════
// WEBSOCKET — connect to Python backend
// ══════════════════════════════════════════════════════
function connectWS(url) {
  try {
    state.ws = new WebSocket(url);
    state.demoMode = false;

    state.ws.onopen = () => {
      sysLog('WebSocket connected to ' + url, 'ok');
      $('ws-dot').className = 'ws-dot connected';
      $('ws-label').textContent = 'Connected';
      setNodesOnline();
    };

    state.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'csi') updateCSIFromBackend(msg);
        if (msg.type === 'hr')  updateHR(msg.bpm);
        if (msg.type === 'inference') {
          updateDetection(msg);
          addLogEntry(msg.verdict, msg.confidence, new Date().toLocaleTimeString());
        }
        if (msg.type === 'training') updateTraining(msg);
        if (msg.type === 'log') sysLog(msg.message, msg.level || 'info');
      } catch(e) { /* ignore malformed */ }
    };

    state.ws.onerror = () => {
      sysLog('WebSocket error — falling back to demo mode', 'err');
      fallbackDemo();
    };

    state.ws.onclose = () => {
      sysLog('WebSocket disconnected', 'warn');
      fallbackDemo();
    };
  } catch(e) {
    sysLog('Failed to connect: ' + e.message, 'err');
    fallbackDemo();
  }
}

function fallbackDemo() {
  state.demoMode = true;
  state.ws = null;
  $('ws-dot').className = 'ws-dot';
  $('ws-label').textContent = 'Demo Mode';
  setNodesOffline();
}

function sendToBackend(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  }
}

// ══════════════════════════════════════════════════════
// BACKEND DATA HANDLERS
// ══════════════════════════════════════════════════════
function updateCSIFromBackend(msg) {
  // msg.amplitudes = Float32Array of subcarrier amps
  if (msg.amplitudes && msg.amplitudes.length === SUBCARRIERS) {
    for (let i = 0; i < SUBCARRIERS; i++) subAmps[i] = msg.amplitudes[i];
  }
}

function updateTraining(msg) {
  // msg = { epoch, total_epochs, loss, val_loss, accuracy }
  const pct = (msg.epoch / msg.total_epochs) * 100;
  $('train-fill').style.width = pct + '%';
  $('train-epoch').textContent = `Epoch ${msg.epoch}/${msg.total_epochs}`;
  $('train-loss').textContent = msg.loss.toFixed(4);
  $('train-val-loss').textContent = msg.val_loss.toFixed(4);
  $('train-acc').textContent = (msg.accuracy * 100).toFixed(1) + '%';

  if (msg.epoch >= msg.total_epochs) {
    sysLog('Training complete — model saved', 'ok');
    state.training = false;
    $('training-wrap').style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════
// SYSTEM NODE STATUS
// ══════════════════════════════════════════════════════
function setNodesOnline() {
  ['esp-tx','esp-rx','watch','model'].forEach(id => {
    $('dot-' + id).className = 'node-dot online';
  });
}
function setNodesOffline() {
  ['esp-tx','esp-rx','watch','model'].forEach(id => {
    $('dot-' + id).className = 'node-dot';
  });
}

// Simulate node status in demo mode
setInterval(() => {
  if (!state.demoMode) return;
  ['dot-esp-tx','dot-esp-rx'].forEach(id => {
    $( id ).className = 'node-dot warn';
  });
  $('dot-watch').className = 'node-dot warn';
  $('dot-model').className = 'node-dot online';
}, 1500);

// ══════════════════════════════════════════════════════
// DATA COLLECTION CONTROLS
// ══════════════════════════════════════════════════════
function startCollection() {
  state.running = true;
  state.sampleCount = 0;
  state.maxSamples = parseInt($('max-samples').value) || 1000;
  $('btn-collect').disabled = true;
  $('btn-stop').disabled = false;
  sysLog('Data collection started (max: ' + state.maxSamples + ' samples)', 'ok');

  // Send to backend
  sendToBackend({
    cmd: 'start_collection',
    max_samples: state.maxSamples,
    append: $('append-data').checked,
    watch_ip: $('watch-ip').value
  });
}

function stopCollection() {
  state.running = false;
  $('btn-collect').disabled = false;
  $('btn-stop').disabled = true;
  sysLog(`Collection stopped — ${state.sampleCount} samples saved`, 'ok');
  sendToBackend({ cmd: 'stop_collection' });
}

$('btn-collect').addEventListener('click', startCollection);
$('btn-stop').addEventListener('click', stopCollection);

// ══════════════════════════════════════════════════════
// TRAIN MODEL
// ══════════════════════════════════════════════════════
$('btn-train').addEventListener('click', () => {
  if (state.training) return;
  state.training = true;
  $('training-wrap').style.display = 'block';
  $('train-fill').style.width = '0%';
  $('train-epoch').textContent = 'Epoch 0/50';
  sysLog('Model training started', 'ok');

  sendToBackend({ cmd: 'train', epochs: 50 });

  if (state.demoMode) simulateTraining();
});

function simulateTraining() {
  let ep = 0;
  const total = 50;
  const interval = setInterval(() => {
    ep++;
    const loss = Math.max(0.08, 1.2 * Math.exp(-ep * 0.1) + (Math.random() - 0.5) * 0.05);
    const val_loss = loss + 0.05 + Math.random() * 0.03;
    const accuracy = Math.min(0.98, 0.5 + ep * 0.009 + Math.random() * 0.02);
    updateTraining({ epoch: ep, total_epochs: total, loss, val_loss, accuracy });
    if (ep >= total) { clearInterval(interval); state.training = false; }
  }, 300);
}

// ══════════════════════════════════════════════════════
// EXPORT SESSION
// ══════════════════════════════════════════════════════
$('btn-export').addEventListener('click', () => {
  const rows = [['timestamp','verdict','confidence','stress','deception','hr','resp']];
  // Export log entries as CSV
  const entries = $('log-entries').querySelectorAll('.log-entry');
  entries.forEach(e => {
    const cells = e.querySelectorAll('span');
    rows.push([cells[0]?.textContent || '', cells[1]?.textContent || '', cells[2]?.textContent || '', '', '', '', '']);
  });

  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `astrix_session_${Date.now()}.csv`;
  a.click();
  sysLog('Session exported as CSV', 'ok');
});

// ══════════════════════════════════════════════════════
// SETTINGS MODAL
// ══════════════════════════════════════════════════════
$('btn-settings').addEventListener('click', () => $('modal-settings').style.display = 'flex');
$('btn-connect').addEventListener('click',  () => $('modal-settings').style.display = 'flex');
$('modal-close').addEventListener('click',  () => $('modal-settings').style.display = 'none');
$('modal-settings').addEventListener('click', e => { if (e.target === $('modal-settings')) $('modal-settings').style.display = 'none'; });

$('btn-ws-connect').addEventListener('click', () => {
  const url = $('ws-url').value.trim();
  $('modal-settings').style.display = 'none';
  sysLog('Connecting to ' + url + '...', 'info');
  connectWS(url);
});

$('btn-ws-demo').addEventListener('click', () => {
  $('modal-settings').style.display = 'none';
  fallbackDemo();
  sysLog('Switched to demo mode', 'ok');
});

// ══════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clamp(v, lo, hi)  { return Math.max(lo, Math.min(hi, v)); }

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
sysLog('Astrix dashboard loaded — running in demo mode', 'ok');
sysLog('Click "Connect Backend" to link to your Python server', 'info');
