'use strict';

/* =========================================================
   Bela u troje — logika aplikacije
   Bez vanjskih biblioteka, čisti ES6+ JavaScript.
   ========================================================= */

// ---------- Konstante ----------
const STORAGE_KEY = 'bela3_state';
const THEME_KEY = 'bela3_theme';
const TOTAL_POINTS = 162; // ukupan zbroj bodova igre po rundi
const HALF_POINTS = TOTAL_POINTS / 2; // 81 — granica za "rušenje"
const CALL_VALUES = [20, 50, 100, 150, 200]; // dostupna zvanja (sekvence)
const BELA_VALUE = 20;

// ---------- Stanje aplikacije ----------
let state = loadState();
let undoSnapshot = null;   // zadnji snapshot rundi za "Poništi zadnju akciju"
let selectedCaller = null; // indeks igrača koji zove u trenutno otvorenom obrascu
let editingRoundIndex = null; // null = nova runda, broj = uređujemo tu rundu
let confirmResolve = null; // resolve funkcija Promisea za confirm modal
let toastTimeout = null;
let selectedSetupCaller = 0; // tko zove prvi (odabrano na početnom ekranu)
let callItemsState = [[], [], []]; // zvanja po igraču u trenutno otvorenom obrascu (tagovi)

// ---------- Pomoćna funkcija za dohvat elemenata ----------
const el = (id) => document.getElementById(id);

// ---------- Perzistencija (LocalStorage) ----------
function defaultState() {
  return { players: ['', '', ''], rounds: [], firstCaller: 0 };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.players) || !Array.isArray(parsed.rounds)) {
      return defaultState();
    }
    if (!Number.isInteger(parsed.firstCaller) || parsed.firstCaller < 0 || parsed.firstCaller > 2) {
      parsed.firstCaller = 0;
    }
    return parsed;
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cloneRounds() {
  return JSON.parse(JSON.stringify(state.rounds));
}

// ---------- Izračuni ----------
function calcTotals() {
  const totals = [0, 0, 0];
  state.rounds.forEach((r) => {
    r.roundTotal.forEach((v, i) => { totals[i] += v; });
  });
  return totals;
}

// Izračunava rezultat runde prema pravilima Bele (uklj. pravilo rušenja).
function computeRound(caller, calls, points) {
  const passed = points[caller] > HALF_POINTS;
  const gamePoints = points.slice();
  if (!passed) gamePoints[caller] = 0; // igrač koji je pao ne dobiva bodove igre
  const roundTotal = gamePoints.map((g, i) => g + calls[i]);
  return {
    caller,
    calls: calls.slice(),
    points: points.slice(),
    passed,
    gamePoints,
    roundTotal,
  };
}

// Zvanje se rotira redom po igračima počevši od onoga tko zove prvi.
function getCallerForRound(roundIndex) {
  return (state.firstCaller + roundIndex) % 3;
}

function getNextCallerIndex() {
  return getCallerForRound(state.rounds.length);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- DOM reference ----------
const setupScreen = el('setup-screen');
const mainScreen = el('main-screen');
const setupForm = el('setup-form');
const setupCallerChoiceEl = el('setup-caller-choice');

const themeToggleBtn = el('theme-toggle');
const newGameBtn = el('new-game-btn');

const scoreboardEl = el('scoreboard');
const roundCountEl = el('round-count');
const nextCallerEl = el('next-caller');

const newRoundBtn = el('new-round-btn');
const undoBtn = el('undo-btn');
const editLastBtn = el('edit-last-btn');
const deleteLastBtn = el('delete-last-btn');

const historyListEl = el('history-list');

const roundModal = el('round-modal');
const modalTitleEl = el('modal-title');
const closeModalBtn = el('close-modal-btn');
const roundForm = el('round-form');
const callerChoiceEl = el('caller-choice');
const callerErrorEl = el('error-caller');
const callsInputsEl = el('calls-inputs');
const pointsInputsEl = el('points-inputs');
const pointsSumEl = el('points-sum');
const pointsErrorEl = el('error-points');
const passFailNoteEl = el('pass-fail-note');

const confirmModal = el('confirm-modal');
const confirmMessageEl = el('confirm-message');
const confirmOkBtn = el('confirm-ok-btn');
const confirmCancelBtn = el('confirm-cancel-btn');

const toastEl = el('toast');

// ---------- Inicijalizacija ----------
function init() {
  initTheme();
  bindEvents();
  if (state.players.every((p) => p && p.trim())) {
    showMainScreen();
  } else {
    showSetupScreen();
  }
}

// ---------- Prikaz ekrana ----------
function showSetupScreen() {
  mainScreen.classList.remove('active');
  setupScreen.classList.add('active');
  selectedSetupCaller = 0;
  buildSetupCallerChoice();
}

function buildSetupCallerChoice() {
  setupCallerChoiceEl.innerHTML = [1, 2, 3].map((n, i) => {
    const typed = el(`player${n}`).value.trim();
    const label = typed || `Igrač ${n}`;
    return `<button type="button" class="caller-btn ${selectedSetupCaller === i ? 'selected' : ''}" data-idx="${i}">${escapeHtml(label)}</button>`;
  }).join('');
}

function showMainScreen() {
  setupScreen.classList.remove('active');
  mainScreen.classList.add('active');
  render();
}

function render() {
  renderScoreboard();
  renderNextCaller();
  renderHistory();
  updateActionButtons();
}

function renderNextCaller() {
  const name = state.players[getNextCallerIndex()];
  nextCallerEl.textContent = `Sljedeći zove: ${name}`;
}

// ---------- Rezultatska ploča ----------
function renderScoreboard() {
  const totals = calcTotals();
  const max = Math.max(...totals);
  const maxCount = totals.filter((t) => t === max).length;
  const uniqueLeader = max > 0 && maxCount === 1 ? totals.indexOf(max) : -1;

  scoreboardEl.innerHTML = state.players.map((name, i) => {
    const isLeader = i === uniqueLeader;
    const diff = max - totals[i];
    const showDiff = !isLeader && max > 0;
    return `
      <div class="score-card ${isLeader ? 'leader' : ''}">
        ${isLeader ? '<span class="crown">👑</span>' : ''}
        <div class="score-name">${escapeHtml(name)}</div>
        <div class="score-value">${totals[i]}</div>
        ${showDiff ? `<div class="score-diff">-${diff}</div>` : ''}
      </div>`;
  }).join('');

  roundCountEl.textContent = `Odigrano rundi: ${state.rounds.length}`;
}

// ---------- Povijest rundi ----------
function renderHistory() {
  if (state.rounds.length === 0) {
    historyListEl.innerHTML = '<p class="empty-state" id="empty-history">Još nema odigranih rundi.</p>';
    return;
  }

  historyListEl.innerHTML = state.rounds.map((r, idx) => {
    const roundNum = idx + 1;
    const callerName = state.players[r.caller];
    const badgeClass = r.passed ? 'badge-pass' : 'badge-fail';
    const badgeText = r.passed ? 'Prošao' : 'Pao';
    return `
      <div class="history-item">
        <button type="button" class="history-summary" data-idx="${idx}" aria-expanded="false">
          <span class="round-num">#${roundNum}</span>
          <span class="round-caller">Zove: ${escapeHtml(callerName)}</span>
          <span class="round-total">${r.roundTotal.join(' / ')}</span>
          <span class="badge ${badgeClass}">${badgeText}</span>
          <span class="chevron">▾</span>
        </button>
        <div class="history-details" hidden>
          ${renderRoundDetailTable(r)}
        </div>
      </div>`;
  }).join('');
}

function renderRoundDetailTable(r) {
  return `
    <table class="detail-table">
      <thead>
        <tr><th>Igrač</th><th>Bodovi igre</th><th>Zvanja</th><th>Ukupno runde</th></tr>
      </thead>
      <tbody>
        ${state.players.map((name, i) => `
          <tr class="${i === r.caller ? 'caller-row' : ''}">
            <td>${escapeHtml(name)}${i === r.caller ? ' 📣' : ''}</td>
            <td>${r.gamePoints[i]}${i === r.caller && !r.passed ? `<span class="fallen-note">(igrao ${r.points[i]}, pao)</span>` : ''}</td>
            <td>${r.calls[i]}${formatCallItemsSummary(r, i)}</td>
            <td><strong>${r.roundTotal[i]}</strong></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function formatCallItemsSummary(r, i) {
  if (!Array.isArray(r.callItems) || r.callItems[i].length === 0) return '';
  const labels = r.callItems[i].map((it) => it.label).join(' + ');
  return `<span class="call-items-note">(${labels})</span>`;
}

function toggleHistoryItem(idx) {
  const btn = historyListEl.querySelector(`.history-summary[data-idx="${idx}"]`);
  if (!btn) return;
  const details = btn.nextElementSibling;
  const expanded = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!expanded));
  details.hidden = expanded;
}

// ---------- Gumbi akcija ----------
function updateActionButtons() {
  const hasRounds = state.rounds.length > 0;
  editLastBtn.disabled = !hasRounds;
  deleteLastBtn.disabled = !hasRounds;
  undoBtn.disabled = undoSnapshot === null;
}

// ---------- Postavljanje igre (setup) ----------
function handleSetupSubmit(e) {
  e.preventDefault();
  const names = [1, 2, 3].map((n) => el(`player${n}`).value.trim());
  let valid = true;

  names.forEach((name, i) => {
    const errorEl = el(`error-player${i + 1}`);
    if (!name) {
      errorEl.textContent = 'Ime ne smije biti prazno.';
      valid = false;
    } else {
      errorEl.textContent = '';
    }
  });

  if (!valid) return;

  state = { players: names, rounds: [], firstCaller: selectedSetupCaller };
  undoSnapshot = null;
  saveState();
  showMainScreen();
}

function clearSetupError(i) {
  el(`error-player${i}`).textContent = '';
}

// ---------- Modal: nova / uredi rundu ----------
function openRoundModal(editMode) {
  editingRoundIndex = editMode ? state.rounds.length - 1 : null;
  const source = editMode ? state.rounds[editingRoundIndex] : null;

  modalTitleEl.textContent = editMode ? 'Uredi zadnju rundu' : 'Nova runda';
  selectedCaller = source ? source.caller : getNextCallerIndex();
  callItemsState = buildInitialCallItems(source);

  buildCallerChoice();
  buildCallsInputs();
  buildPlayerInputs(pointsInputsEl, 'points', source ? source.points : [null, null, null]);

  callerErrorEl.textContent = '';
  pointsErrorEl.textContent = '';
  updatePointsSum();

  roundModal.classList.add('open');
  document.body.classList.add('modal-open');
}

function closeRoundModal() {
  roundModal.classList.remove('open');
  document.body.classList.remove('modal-open');
}

function buildCallerChoice() {
  callerChoiceEl.innerHTML = state.players.map((name, i) => `
    <button type="button" class="caller-btn ${selectedCaller === i ? 'selected' : ''}" data-idx="${i}">${escapeHtml(name)}</button>
  `).join('');
}

function buildPlayerInputs(container, kind, values) {
  container.innerHTML = state.players.map((name, i) => {
    const v = values[i];
    const displayValue = (v === null || v === undefined) ? '' : v;
    return `
    <div class="player-input">
      <label for="${kind}-${i}">${escapeHtml(name)}</label>
      <input type="number" inputmode="numeric" min="0" step="1" id="${kind}-${i}" value="${displayValue}" placeholder="0" data-kind="${kind}" data-idx="${i}">
    </div>`;
  }).join('');
}

function getFieldValues(kind) {
  return [0, 1, 2].map((i) => {
    const raw = el(`${kind}-${i}`).value;
    if (raw === '') return 0;
    return parseInt(raw, 10);
  });
}

// ---------- Zvanja: odabir putem tagova ----------
function buildInitialCallItems(source) {
  if (!source) return [[], [], []];
  if (Array.isArray(source.callItems)) {
    return source.callItems.map((items) => items.map((it) => ({ ...it })));
  }
  // starije runde bez raščlanjenih zvanja — prikaži ukupan iznos kao jednu stavku
  return source.calls.map((v) => (v > 0 ? [{ value: v, label: String(v) }] : []));
}

function sumCallItems(i) {
  return callItemsState[i].reduce((sum, it) => sum + it.value, 0);
}

function getCallsValues() {
  return [0, 1, 2].map((i) => sumCallItems(i));
}

function buildCallsInputs() {
  callsInputsEl.innerHTML = state.players.map((name, i) => `
    <div class="calls-player">
      <div class="calls-player-name">${escapeHtml(name)}</div>
      <div class="call-chip-picker">
        ${CALL_VALUES.map((v) => `<button type="button" class="chip-add" data-player="${i}" data-value="${v}" data-label="${v}">${v}</button>`).join('')}
        <button type="button" class="chip-add chip-bela" data-player="${i}" data-value="${BELA_VALUE}" data-label="Bela">Bela</button>
      </div>
      <div class="call-tags" id="call-tags-${i}">${renderCallTags(i)}</div>
      <div class="call-subtotal">Zvanja: <span id="call-subtotal-${i}">${sumCallItems(i)}</span></div>
    </div>
  `).join('');
}

function renderCallTags(i) {
  const items = callItemsState[i];
  if (items.length === 0) return '<span class="calls-empty-hint">Nema zvanja</span>';
  return items.map((it, itemIdx) => `
    <span class="call-tag ${it.label === 'Bela' ? 'tag-bela' : ''}">
      ${escapeHtml(it.label)}
      <button type="button" class="call-tag-remove" data-player="${i}" data-item="${itemIdx}" aria-label="Ukloni zvanje">✕</button>
    </span>
  `).join('');
}

function refreshCallsPlayer(playerIdx) {
  el(`call-tags-${playerIdx}`).innerHTML = renderCallTags(playerIdx);
  el(`call-subtotal-${playerIdx}`).textContent = sumCallItems(playerIdx);
}

// ---------- Bodovi: automatski izračun trećeg polja ----------
function autoCompleteThirdPoints() {
  const inputs = [0, 1, 2].map((i) => el(`points-${i}`));
  const blanks = [];
  let filledSum = 0;
  inputs.forEach((inp, i) => {
    if (inp.value.trim() === '') blanks.push(i);
    else filledSum += (parseInt(inp.value, 10) || 0);
  });
  if (blanks.length === 1) {
    const remaining = TOTAL_POINTS - filledSum;
    inputs[blanks[0]].value = remaining >= 0 ? remaining : 0;
  }
}

function updatePointsSum() {
  autoCompleteThirdPoints();
  const values = getFieldValues('points');
  const sum = values.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);
  pointsSumEl.textContent = `Zbroj: ${sum} / ${TOTAL_POINTS}`;
  const ok = sum === TOTAL_POINTS;
  pointsSumEl.classList.toggle('sum-ok', ok);
  pointsSumEl.classList.toggle('sum-bad', !ok);
  updatePassFailNote(values);
}

function updatePassFailNote(values) {
  passFailNoteEl.classList.remove('note-pass', 'note-fail');
  const hasAnyInput = [0, 1, 2].some((i) => el(`points-${i}`).value.trim() !== '');
  if (selectedCaller === null || !hasAnyInput) {
    passFailNoteEl.textContent = '';
    return;
  }
  const p = values[selectedCaller];
  const passed = p > HALF_POINTS;
  const callerName = state.players[selectedCaller];
  passFailNoteEl.textContent = passed
    ? `${callerName} prolazi (${p} / ${TOTAL_POINTS}).`
    : `${callerName} pada (${p} / ${TOTAL_POINTS}).`;
  passFailNoteEl.classList.add(passed ? 'note-pass' : 'note-fail');
}

function handleRoundSubmit(e) {
  e.preventDefault();
  callerErrorEl.textContent = '';
  pointsErrorEl.textContent = '';
  let valid = true;

  if (selectedCaller === null) {
    callerErrorEl.textContent = 'Odaberite tko zove.';
    valid = false;
  }

  const calls = getCallsValues();
  const points = getFieldValues('points');

  if (points.some((v) => Number.isNaN(v) || v < 0)) {
    pointsErrorEl.textContent = 'Bodovi moraju biti pozitivni cijeli brojevi.';
    valid = false;
  } else {
    const sum = points.reduce((a, b) => a + b, 0);
    if (sum !== TOTAL_POINTS) {
      pointsErrorEl.textContent = `Zbroj bodova igre mora biti točno ${TOTAL_POINTS} (trenutno: ${sum}).`;
      valid = false;
    }
  }

  if (!valid) return;

  pushUndoSnapshot();
  const round = computeRound(selectedCaller, calls, points);
  round.callItems = callItemsState.map((items) => items.map((it) => ({ ...it })));

  if (editingRoundIndex !== null) {
    state.rounds[editingRoundIndex] = round;
  } else {
    state.rounds.push(round);
  }

  saveState();
  closeRoundModal();
  render();
  showToast(editingRoundIndex !== null ? 'Runda ažurirana.' : 'Runda spremljena.');
}

// ---------- Brisanje zadnje runde ----------
async function handleDeleteLast() {
  if (state.rounds.length === 0) return;
  const ok = await showConfirm('Obrisati zadnju rundu?');
  if (!ok) return;
  pushUndoSnapshot();
  state.rounds.pop();
  saveState();
  render();
  showToast('Zadnja runda obrisana.');
}

// ---------- Undo ----------
function pushUndoSnapshot() {
  undoSnapshot = cloneRounds();
}

function handleUndo() {
  if (undoSnapshot === null) return;
  state.rounds = undoSnapshot;
  undoSnapshot = null;
  saveState();
  render();
  showToast('Zadnja akcija poništena.');
}

// ---------- Nova igra ----------
async function handleNewGame() {
  const ok = await showConfirm('Jeste li sigurni? Ovo će obrisati sve rezultate.');
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  undoSnapshot = null;
  setupForm.reset();
  [1, 2, 3].forEach((n) => clearSetupError(n));
  showSetupScreen();
}

// ---------- Confirm modal (Promise-based) ----------
function showConfirm(message) {
  confirmMessageEl.textContent = message;
  confirmModal.classList.add('open');
  document.body.classList.add('modal-open');
  return new Promise((resolve) => { confirmResolve = resolve; });
}

function resolveConfirm(result) {
  confirmModal.classList.remove('open');
  document.body.classList.remove('modal-open');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

// ---------- Toast obavijesti ----------
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

// ---------- Tema (light / dark) ----------
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ---------- Vezanje događaja ----------
function bindEvents() {
  setupForm.addEventListener('submit', handleSetupSubmit);
  [1, 2, 3].forEach((n) => el(`player${n}`).addEventListener('input', () => {
    clearSetupError(n);
    buildSetupCallerChoice();
  }));

  setupCallerChoiceEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.caller-btn');
    if (!btn) return;
    selectedSetupCaller = parseInt(btn.dataset.idx, 10);
    buildSetupCallerChoice();
  });

  themeToggleBtn.addEventListener('click', toggleTheme);
  newGameBtn.addEventListener('click', handleNewGame);

  newRoundBtn.addEventListener('click', () => openRoundModal(false));
  editLastBtn.addEventListener('click', () => openRoundModal(true));
  deleteLastBtn.addEventListener('click', handleDeleteLast);
  undoBtn.addEventListener('click', handleUndo);

  closeModalBtn.addEventListener('click', closeRoundModal);
  roundForm.addEventListener('submit', handleRoundSubmit);

  callerChoiceEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.caller-btn');
    if (!btn) return;
    selectedCaller = parseInt(btn.dataset.idx, 10);
    callerErrorEl.textContent = '';
    buildCallerChoice();
    updatePointsSum();
  });

  callsInputsEl.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.chip-add');
    if (addBtn) {
      const playerIdx = parseInt(addBtn.dataset.player, 10);
      const value = parseInt(addBtn.dataset.value, 10);
      const label = addBtn.dataset.label;
      callItemsState[playerIdx].push({ value, label });
      refreshCallsPlayer(playerIdx);
      return;
    }
    const removeBtn = e.target.closest('.call-tag-remove');
    if (removeBtn) {
      const playerIdx = parseInt(removeBtn.dataset.player, 10);
      const itemIdx = parseInt(removeBtn.dataset.item, 10);
      callItemsState[playerIdx].splice(itemIdx, 1);
      refreshCallsPlayer(playerIdx);
    }
  });

  pointsInputsEl.addEventListener('input', updatePointsSum);

  historyListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.history-summary');
    if (!btn) return;
    toggleHistoryItem(parseInt(btn.dataset.idx, 10));
  });

  roundModal.addEventListener('click', (e) => {
    if (e.target === roundModal) closeRoundModal();
  });

  confirmOkBtn.addEventListener('click', () => resolveConfirm(true));
  confirmCancelBtn.addEventListener('click', () => resolveConfirm(false));
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) resolveConfirm(false);
  });
}

// ---------- Start ----------
document.addEventListener('DOMContentLoaded', init);
