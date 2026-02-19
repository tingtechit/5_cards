const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["H", "D", "C", "S"];
const SUIT_SYMBOL = { H: "♥", D: "♦", C: "♣", S: "♠" };

const ui = {
  setupPanel: document.getElementById("setupPanel"),
  gamePanel: document.getElementById("gamePanel"),
  playerCount: document.getElementById("playerCount"),
  botCount: document.getElementById("botCount"),
  roundCount: document.getElementById("roundCount"),
  playerNames: document.getElementById("playerNames"),
  startLocalBtn: document.getElementById("startLocalBtn"),
  setupError: document.getElementById("setupError"),
  roundLabel: document.getElementById("roundLabel"),
  turnLabel: document.getElementById("turnLabel"),
  phaseLabel: document.getElementById("phaseLabel"),
  drawCount: document.getElementById("drawCount"),
  previousDiscardVisual: document.getElementById("previousDiscardVisual"),
  previousDiscardMeta: document.getElementById("previousDiscardMeta"),
  currentDiscardVisual: document.getElementById("currentDiscardVisual"),
  currentDiscardMeta: document.getElementById("currentDiscardMeta"),
  drawPileBtn: document.getElementById("drawPileBtn"),
  takeDiscardBtn: document.getElementById("takeDiscardBtn"),
  showBtn: document.getElementById("showBtn"),
  discardBtn: document.getElementById("discardBtn"),
  playerStrip: document.getElementById("playerStrip"),
  handTitle: document.getElementById("handTitle"),
  handPoints: document.getElementById("handPoints"),
  handCards: document.getElementById("handCards"),
  scoreboard: document.getElementById("scoreboard"),
  logBox: document.getElementById("logBox"),
  resultPanel: document.getElementById("resultPanel"),
  modalTitle: document.getElementById("modalTitle"),
  revealBox: document.getElementById("revealBox"),
  resultFx: document.getElementById("resultFx"),
  nextRoundBtn: document.getElementById("nextRoundBtn"),
};

const state = {
  players: [],
  viewerIndex: 0,
  roundsTarget: 1,
  roundNumber: 1,
  currentPlayerIndex: 0,
  phase: "discard",
  drawPile: [],
  discardPool: [],
  selectedHand: new Set(),
  selectedPreviousIndex: null,
  gameOver: false,
  botTimer: null,
  revealRunning: false,
};

let dragFromIndex = null;
let audioCtx;

function tone(freq, duration = 0.08, type = "triangle", volume = 0.04) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playSfx(kind) {
  try {
    if (kind === "draw") {
      tone(370, 0.06);
      setTimeout(() => tone(470, 0.05), 40);
    } else if (kind === "discard") {
      tone(210, 0.09, "sawtooth", 0.03);
    } else if (kind === "show") {
      tone(600, 0.1);
      setTimeout(() => tone(800, 0.1), 60);
    } else if (kind === "invalid") {
      tone(130, 0.08, "square", 0.03);
    }
  } catch (_e) {
    // ignore
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cardPoints(card) {
  if (card.rank === "JOKER") return 0;
  if (card.rank === "A") return 1;
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function handPoints(hand) {
  return hand.reduce((sum, c) => sum + cardPoints(c), 0);
}

function isRed(card) {
  return card.suit === "H" || card.suit === "D";
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function decksNeeded(playerCount) {
  return Math.max(1, Math.ceil((playerCount * 5 + 20) / 54));
}

function makeDeck(playerCount) {
  const copies = decksNeeded(playerCount);
  const deck = [];
  for (let n = 0; n < copies; n += 1) {
    for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
    deck.push({ rank: "JOKER", suit: "" });
    deck.push({ rank: "JOKER", suit: "" });
  }
  return shuffle(deck);
}

function renderCardText(card) {
  return card.rank === "JOKER" ? "JOKER" : `${card.rank}${card.suit}`;
}

function avatarForName(name) {
  const avatars = ["🧑", "👩", "👨", "🧔", "👩‍🦱", "👨‍🦱", "🧑‍🦰", "👩‍🦳"];
  const hash = [...name].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  return avatars[hash % avatars.length];
}

function clearLastDiscards() {
  for (const p of state.players) p.lastDiscard = [];
}

function reshuffleDiscardIntoDrawIfNeeded() {
  if (state.drawPile.length > 0) return false;
  if (!state.discardPool.length) return false;
  state.drawPile = shuffle([...state.discardPool]);
  state.discardPool = [];
  clearLastDiscards();
  return true;
}

function normalizeNames(count, raw) {
  const inNames = raw.split(",").map((n) => n.trim()).filter(Boolean);
  return Array.from({ length: count }, (_, i) => inNames[i] || `Player ${i + 1}`);
}

function createPlayers(humanCount, botCount, names) {
  const players = [];
  for (let i = 0; i < humanCount; i += 1) {
    players.push({ name: names[i], kind: "human", avatar: avatarForName(names[i]), hand: [], totalScore: 0, lastDiscard: [] });
  }
  for (let i = 0; i < botCount; i += 1) {
    players.push({ name: `Bot ${i + 1}`, kind: "bot", avatar: "🤖", hand: [], totalScore: 0, lastDiscard: [] });
  }
  return players;
}

function logLine(text) {
  const d = document.createElement("div");
  d.className = "log-line";
  d.textContent = text;
  ui.logBox.prepend(d);
}

function startRound() {
  const deck = makeDeck(state.players.length);
  for (const p of state.players) {
    p.hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
    p.lastDiscard = [];
  }
  state.drawPile = deck;
  state.discardPool = [];
  state.currentPlayerIndex = 0;
  state.phase = "discard";
  state.selectedHand.clear();
  state.selectedPreviousIndex = null;
  logLine(`Round ${state.roundNumber} started.`);
}

function startGame() {
  const humanCount = Number(ui.playerCount.value);
  const botCount = Number(ui.botCount.value);
  const rounds = Number(ui.roundCount.value);

  if (!Number.isInteger(humanCount) || humanCount < 1 || humanCount > 4) return (ui.setupError.textContent = "Human players must be 1..4");
  if (!Number.isInteger(botCount) || botCount < 0 || botCount > 7) return (ui.setupError.textContent = "Bot players must be 0..7");
  if (humanCount + botCount < 2 || humanCount + botCount > 8) return (ui.setupError.textContent = "Total players must be 2..8");
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) return (ui.setupError.textContent = "Rounds must be 1..20");

  const names = normalizeNames(humanCount, ui.playerNames.value);
  state.players = createPlayers(humanCount, botCount, names);
  state.viewerIndex = state.players.findIndex((p) => p.kind === "human");
  if (state.viewerIndex < 0) state.viewerIndex = 0;
  state.roundsTarget = rounds;
  state.roundNumber = 1;
  state.gameOver = false;
  state.revealRunning = false;
  ui.logBox.innerHTML = "";
  ui.setupError.textContent = "";
  ui.resultPanel.classList.add("hidden");

  startRound();
  ui.setupPanel.classList.add("hidden");
  ui.gamePanel.classList.remove("hidden");
  render();
  maybeRunBot();
}

function currentPlayer() {
  return state.players[state.currentPlayerIndex];
}

function canCurrentHumanAct() {
  return !state.gameOver && currentPlayer().kind === "human";
}

function previousPlayerIndex() {
  return (state.currentPlayerIndex - 1 + state.players.length) % state.players.length;
}

function previousDiscardGroup() {
  return state.players[previousPlayerIndex()].lastDiscard;
}

function nextTurn() {
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  state.phase = "discard";
  state.selectedHand.clear();
  state.selectedPreviousIndex = null;
  render();
  maybeRunBot();
}

function selectedSameRank(hand, selectedSet) {
  const idxs = [...selectedSet];
  if (!idxs.length) return false;
  const rank = hand[idxs[0]]?.rank;
  if (!rank) return false;
  return idxs.every((i) => hand[i] && hand[i].rank === rank);
}

function removeOneFromDiscardPool(card) {
  const idx = state.discardPool.findIndex((c) => c.rank === card.rank && c.suit === card.suit);
  if (idx >= 0) state.discardPool.splice(idx, 1);
}

function toggleHandSelect(index) {
  const cp = currentPlayer();
  if (state.gameOver || state.phase !== "discard" || cp.kind !== "human") return;
  if (state.selectedHand.has(index)) state.selectedHand.delete(index);
  else state.selectedHand.add(index);
  render();
}

function onHandDragStart(index) {
  dragFromIndex = index;
}

function onHandDrop(targetIndex) {
  if (dragFromIndex == null || dragFromIndex === targetIndex) return;
  const viewer = currentPlayer().kind === "human" ? currentPlayer() : state.players[state.viewerIndex];
  const [card] = viewer.hand.splice(dragFromIndex, 1);
  viewer.hand.splice(targetIndex, 0, card);
  dragFromIndex = null;
  state.selectedHand.clear();
  render();
}

function discardSelected() {
  const cp = currentPlayer();
  if (state.gameOver || state.phase !== "discard" || cp.kind !== "human") return;
  if (!state.selectedHand.size) return void (playSfx("invalid"), logLine("Select cards to discard."));
  if (!selectedSameRank(cp.hand, state.selectedHand)) return void (playSfx("invalid"), logLine("Discard cards must be same rank."));

  const idxs = [...state.selectedHand].sort((a, b) => a - b);
  const group = idxs.map((i) => cp.hand[i]);
  for (let i = idxs.length - 1; i >= 0; i -= 1) cp.hand.splice(idxs[i], 1);

  cp.lastDiscard = group.map((c) => ({ ...c }));
  state.discardPool.push(...group.map((c) => ({ ...c })));
  state.phase = "draw";
  state.selectedHand.clear();
  state.selectedPreviousIndex = null;
  playSfx("discard");
  logLine(`${cp.name} discarded: ${group.map(renderCardText).join(" ")}.`);
  render();
}

function drawFromPile() {
  const cp = currentPlayer();
  if (state.gameOver || state.phase !== "draw" || cp.kind !== "human") return;

  if (reshuffleDiscardIntoDrawIfNeeded()) logLine("Draw pile empty. Shuffled discarded cards into new pile.");
  if (!state.drawPile.length) return void (playSfx("invalid"), logLine("No cards left to draw."));

  cp.hand.push(state.drawPile.pop());
  playSfx("draw");
  logLine(`${cp.name} drew from pile.`);
  nextTurn();
}

function selectPreviousDiscardCard(idx) {
  const cp = currentPlayer();
  if (state.gameOver || state.phase !== "draw" || cp.kind !== "human") return;
  if (!previousDiscardGroup().length) return;
  if (idx < 0 || idx >= previousDiscardGroup().length) return;
  state.selectedPreviousIndex = idx;
  render();
}

function takePreviousDiscardOne() {
  const cp = currentPlayer();
  if (state.gameOver || state.phase !== "draw" || cp.kind !== "human") return;

  const prevIdx = previousPlayerIndex();
  const group = state.players[prevIdx].lastDiscard;
  if (!group.length) return void (playSfx("invalid"), logLine("No previous player's discarded card available."));

  let pick = state.selectedPreviousIndex ?? 0;
  if (pick < 0 || pick >= group.length) pick = 0;
  const [card] = group.splice(pick, 1);
  cp.hand.push(card);
  removeOneFromDiscardPool(card);
  state.selectedPreviousIndex = null;
  playSfx("draw");
  logLine(`${cp.name} picked from previous discard: ${renderCardText(card)}.`);
  nextTurn();
}

function chooseBestDiscard(hand) {
  const byRank = new Map();
  hand.forEach((c, i) => {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(i);
  });
  let best = [0];
  let bestValue = -1;
  for (const idxs of byRank.values()) {
    const value = idxs.reduce((s, i) => s + cardPoints(hand[i]), 0);
    if (value > bestValue || (value === bestValue && idxs.length > best.length)) {
      best = idxs;
      bestValue = value;
    }
  }
  return best.sort((a, b) => a - b);
}

function maybeRunBot() {
  const p = currentPlayer();
  if (state.gameOver || !p || p.kind !== "bot") return;
  if (state.botTimer) clearTimeout(state.botTimer);
  state.botTimer = setTimeout(() => runBotTurn(p), 700);
}

function runBotTurn(bot) {
  if (state.gameOver || currentPlayer() !== bot) return;

  if (state.phase === "discard") {
    const pts = handPoints(bot.hand);
    if (pts <= 7) {
      logLine(`${bot.name} calls Show.`);
      resolveShow(state.currentPlayerIndex);
      return;
    }

    const idxs = chooseBestDiscard(bot.hand);
    const group = idxs.map((i) => bot.hand[i]);
    for (let i = idxs.length - 1; i >= 0; i -= 1) bot.hand.splice(idxs[i], 1);
    bot.lastDiscard = group.map((c) => ({ ...c }));
    state.discardPool.push(...group.map((c) => ({ ...c })));
    state.phase = "draw";
    playSfx("discard");
    logLine(`${bot.name} discarded ${group.map(renderCardText).join(" ")}.`);
    render();
    return maybeRunBot();
  }

  const prevGroup = previousDiscardGroup();
  const pickFromPrev = prevGroup.length && Math.min(...prevGroup.map(cardPoints)) <= 4;
  if (pickFromPrev) {
    const minIndex = prevGroup.reduce((best, c, i, arr) => (cardPoints(c) < cardPoints(arr[best]) ? i : best), 0);
    const [card] = prevGroup.splice(minIndex, 1);
    bot.hand.push(card);
    removeOneFromDiscardPool(card);
    playSfx("draw");
    logLine(`${bot.name} picked one card from previous discard.`);
    return nextTurn();
  }

  if (reshuffleDiscardIntoDrawIfNeeded()) logLine("Draw pile empty. Shuffled discarded cards into new pile.");
  if (!state.drawPile.length) {
    logLine(`${bot.name} cannot draw and calls Show.`);
    resolveShow(state.currentPlayerIndex);
    return;
  }

  bot.hand.push(state.drawPile.pop());
  playSfx("draw");
  logLine(`${bot.name} drew from pile.`);
  nextTurn();
}

function showNow() {
  const cp = currentPlayer();
  if (state.gameOver || state.phase !== "discard" || cp.kind !== "human") return;
  resolveShow(state.currentPlayerIndex);
}

function resolveShow(showerIndex) {
  const shower = state.players[showerIndex];
  const showerPts = handPoints(shower.hand);
  const strictLowest = state.players.every((p, i) => i === showerIndex || showerPts < handPoints(p.hand));

  const additions = new Map();
  const cardTie = (a, b) => {
    const pa = cardPoints(a);
    const pb = cardPoints(b);
    if (pa !== pb) return pa - pb;
    if (a.rank !== b.rank) return a.rank.localeCompare(b.rank);
    return (a.suit || "").localeCompare(b.suit || "");
  };
  const reveal = state.players.map((p, i) => {
    const pts = handPoints(p.hand);
    let add;
    if (strictLowest) add = i === showerIndex ? 0 : pts;
    else if (i === showerIndex) add = 50;
    else add = pts <= showerPts ? 0 : pts;
    p.totalScore += add;
    additions.set(p.name, add);
    return {
      index: i,
      name: p.name,
      points: pts,
      hand: p.hand.map((c) => ({ ...c })),
      handSorted: [...p.hand].sort(cardTie).map((c) => ({ ...c })),
      total: p.totalScore,
    };
  });

  playSfx("show");
  openRevealModal(showerIndex, strictLowest, reveal, additions);
}

async function openRevealModal(showerIndex, strictLowest, reveal, additions) {
  if (state.revealRunning) return;
  state.revealRunning = true;

  const shower = state.players[showerIndex];
  const isViewerShow = showerIndex === state.viewerIndex;
  const sorted = [...reveal].sort((a, b) => a.points - b.points);

  ui.modalTitle.textContent = `${shower.name} called SHOW`;
  ui.revealBox.innerHTML = "";
  ui.resultFx.innerHTML = "";
  ui.resultPanel.classList.remove("result-win", "result-lose");
  ui.nextRoundBtn.disabled = true;
  ui.resultPanel.classList.remove("hidden");
  const title = document.createElement("p");
  title.className = "reveal-title";
  title.textContent = "Revealing players in ascending points...";
  ui.revealBox.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "reveal-grid";
  ui.revealBox.appendChild(grid);

  const columnByName = new Map();
  for (const r of sorted) {
    const col = document.createElement("article");
    col.className = "reveal-col";

    const cardsRow = document.createElement("div");
    cardsRow.className = "reveal-cards";
    for (let i = 0; i < r.hand.length; i += 1) cardsRow.appendChild(renderResultBackCard());

    col.innerHTML = `
      <h4>${r.name}${r.index === state.viewerIndex ? " (You)" : ""}</h4>
      <p class="reveal-points">Points: <strong>??</strong></p>
      <p class="reveal-add">Round Add: <strong>??</strong></p>
      <p class="reveal-total">Total: <strong>??</strong></p>
    `;
    col.appendChild(cardsRow);
    grid.appendChild(col);
    columnByName.set(r.name, col);
  }

  const revealOne = async (r, delayMs) => {
    const col = columnByName.get(r.name);
    if (!col) return;
    await sleep(delayMs);
    col.classList.add("reveal-live");
    const cardsRow = col.querySelector(".reveal-cards");
    cardsRow.innerHTML = "";
    for (const card of r.handSorted) {
      cardsRow.appendChild(renderResultCardFace(card));
      await sleep(420);
    }
    col.querySelector(".reveal-points strong").textContent = String(r.points);
    col.querySelector(".reveal-add strong").textContent = `+${additions.get(r.name)}`;
    col.querySelector(".reveal-total strong").textContent = String(r.total);
  };

  if (isViewerShow) {
    for (const r of sorted) await revealOne(r, 850);
    const win = strictLowest;
    if (win) {
      ui.resultPanel.classList.add("result-win");
      ui.resultFx.innerHTML = '<div class="fx-win"><img alt=\"Fireworks\" src=\"https://media.giphy.com/media/26tOZ42Mg6pbTUPHW/giphy.gif\" /></div><p class=\"win-text\">You WON this round!</p>';
    } else {
      ui.resultPanel.classList.add("result-lose");
      ui.resultFx.innerHTML = '<div class="fx-lose"><img alt=\"Sad\" src=\"https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif\" /></div><p class=\"lose-text\">You LOST this round.</p>';
    }
  } else {
    for (const r of sorted) await revealOne(r, 100);
  }

  ui.nextRoundBtn.textContent = state.roundNumber >= state.roundsTarget ? "Finish Game" : "Next Round";
  ui.nextRoundBtn.disabled = false;
  state.revealRunning = false;
}

function renderResultCardFace(card) {
  const el = document.createElement("div");
  el.className = `result-card ${card.rank === "JOKER" ? "joker" : isRed(card) ? "red" : "black"}`;
  if (card.rank === "JOKER") {
    el.innerHTML = '<div class="joker-mark">JOKER</div><div class="joker-star">★</div>';
    return el;
  }
  const suit = SUIT_SYMBOL[card.suit];
  el.innerHTML = `
    <span class=\"corner tl\">${card.rank}<br>${suit}</span>
    <span class=\"center-suit\">${suit}</span>
    <span class=\"corner br\">${card.rank}<br>${suit}</span>
  `;
  return el;
}

function renderResultBackCard() {
  const el = document.createElement("div");
  el.className = "result-card-back";
  return el;
}

function nextRound() {
  ui.resultPanel.classList.remove("result-win", "result-lose");
  ui.resultPanel.classList.add("hidden");
  if (state.roundNumber >= state.roundsTarget) {
    state.gameOver = true;
    const winner = [...state.players].sort((a, b) => a.totalScore - b.totalScore)[0];
    logLine(`Game over. Winner: ${winner.name} (${winner.totalScore}).`);
    render();
    return;
  }

  state.roundNumber += 1;
  startRound();
  render();
  maybeRunBot();
}

function makeMiniCard(card, className = "discard-mini") {
  const el = document.createElement("span");
  el.className = `${className} ${(isRed(card) ? "red" : "black")}`;
  el.textContent = card.rank === "JOKER" ? "🃏" : `${card.rank}${SUIT_SYMBOL[card.suit]}`;
  return el;
}

function renderCardFace(card, selectable, selected, index) {
  const btn = document.createElement("button");
  btn.className = `play-card ${selected ? "selected" : ""} ${card.rank === "JOKER" ? "joker" : ""}`;
  btn.disabled = !selectable;
  btn.draggable = true;

  if (card.rank === "JOKER") {
    btn.innerHTML = '<div class="joker-mark">JOKER</div><div class="joker-star">★</div>';
  } else {
    btn.classList.add(isRed(card) ? "red" : "black");
    const suit = SUIT_SYMBOL[card.suit];
    btn.innerHTML = `
      <span class="corner tl">${card.rank}<br>${suit}</span>
      <span class="center-suit">${suit}</span>
      <span class="corner br">${card.rank}<br>${suit}</span>
    `;
  }

  btn.addEventListener("click", () => toggleHandSelect(index));
  btn.addEventListener("dragstart", () => onHandDragStart(index));
  btn.addEventListener("dragover", (e) => e.preventDefault());
  btn.addEventListener("drop", () => onHandDrop(index));
  return btn;
}

function render() {
  const cp = currentPlayer();
  if (cp.kind === "human") state.viewerIndex = state.currentPlayerIndex;
  const viewer = state.players[state.viewerIndex] || cp;
  const viewerTurn = canCurrentHumanAct();
  const prevIdx = previousPlayerIndex();
  const prevGroup = previousDiscardGroup();
  const topGroup = cp.lastDiscard;

  ui.roundLabel.textContent = `${state.roundNumber} / ${state.roundsTarget}`;
  ui.turnLabel.textContent = state.gameOver ? "Game Finished" : cp.name;
  ui.phaseLabel.textContent = state.gameOver ? "Completed" : state.phase === "discard" ? "Discard" : "Draw";
  ui.drawCount.textContent = String(state.drawPile.length);

  ui.previousDiscardVisual.innerHTML = "";
  if (!prevGroup.length) {
    ui.previousDiscardVisual.textContent = "Empty";
    ui.previousDiscardMeta.textContent = "No previous discard";
  } else {
    prevGroup.forEach((card, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `discard-mini ${(isRed(card) ? "red" : "black")} ${state.selectedPreviousIndex === idx ? "selected" : ""} ${viewerTurn && state.phase === "draw" ? "selectable" : ""}`;
      b.textContent = card.rank === "JOKER" ? "🃏" : `${card.rank}${SUIT_SYMBOL[card.suit]}`;
      b.disabled = !(viewerTurn && state.phase === "draw");
      b.addEventListener("click", () => selectPreviousDiscardCard(idx));
      ui.previousDiscardVisual.appendChild(b);
    });
    ui.previousDiscardMeta.textContent = `From ${state.players[prevIdx].name} (${prevGroup.length} card(s))`;
  }

  ui.currentDiscardVisual.innerHTML = "";
  if (!topGroup.length) {
    ui.currentDiscardVisual.textContent = "Empty";
    ui.currentDiscardMeta.textContent = "No current discard";
  } else {
    topGroup.forEach((card) => ui.currentDiscardVisual.appendChild(makeMiniCard(card)));
    ui.currentDiscardMeta.textContent = `${cp.name}'s discard (${topGroup.length} card(s))`;
  }

  ui.playerStrip.innerHTML = "";
  state.players.forEach((p, i) => {
    const chip = document.createElement("article");
    const isPrev = i === prevIdx;
    chip.className = `player-chip ${i === state.currentPlayerIndex ? "current" : ""} ${isPrev ? "prev-highlight" : ""}`;
    const last = p.lastDiscard.length ? p.lastDiscard.map(renderCardText).join(" ") : "none";
    const miniBacks = Array.from({ length: Math.min(p.hand.length, 8) }).map(() => '<span class="mini-back"></span>').join("");
    chip.innerHTML = `
      <div class="player-head">
        <span class="player-avatar">${p.kind === "bot" ? "🤖" : p.avatar}</span>
        <strong>${p.name}${p.kind === "bot" ? " [BOT]" : ""}</strong>
      </div>
      <p>Total score: ${p.totalScore}</p>
      <p>Cards in hand: ${p.hand.length}</p>
      <p>Last discard: ${last}</p>
      ${p.kind === "bot" ? `<div class="mini-hand">${miniBacks}</div>` : ""}
      <span class="live-dot ${i === state.currentPlayerIndex ? "live" : ""}"></span>
    `;
    ui.playerStrip.appendChild(chip);
  });

  ui.handTitle.textContent = `${viewer.name}'s Hand`;
  ui.handPoints.textContent = `Points: ${handPoints(viewer.hand)}`;
  ui.handCards.innerHTML = "";
  viewer.hand.forEach((card, i) => {
    const canSelect = viewerTurn && state.phase === "discard";
    ui.handCards.appendChild(renderCardFace(card, canSelect, state.selectedHand.has(i), i));
  });

  const scoreRows = [...state.players]
    .sort((a, b) => a.totalScore - b.totalScore)
    .map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.totalScore}</td></tr>`)
    .join("");
  ui.scoreboard.innerHTML = `<table><thead><tr><th>#</th><th>Player</th><th>Total</th></tr></thead><tbody>${scoreRows}</tbody></table>`;

  const canDiscard = viewerTurn && state.phase === "discard" && state.selectedHand.size > 0 && selectedSameRank(viewer.hand, state.selectedHand);
  const canDrawPile = viewerTurn && state.phase === "draw";
  const canTakePrev = viewerTurn && state.phase === "draw" && prevGroup.length > 0;

  ui.discardBtn.disabled = !canDiscard;
  ui.drawPileBtn.disabled = !canDrawPile;
  ui.takeDiscardBtn.disabled = !canTakePrev;
  ui.showBtn.disabled = !(viewerTurn && state.phase === "discard");
}

ui.startLocalBtn.addEventListener("click", startGame);
ui.discardBtn.addEventListener("click", discardSelected);
ui.drawPileBtn.addEventListener("click", drawFromPile);
ui.takeDiscardBtn.addEventListener("click", takePreviousDiscardOne);
ui.showBtn.addEventListener("click", showNow);
ui.nextRoundBtn.addEventListener("click", nextRound);
