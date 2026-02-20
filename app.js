const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["H", "D", "C", "S"];
const SUIT_SYMBOL = { H: "♥", D: "♦", C: "♣", S: "♠" };

const ui = {
  setupPanel: document.getElementById("setupPanel"),
  gamePanel: document.getElementById("gamePanel"),
  onlineTabBtn: document.getElementById("onlineTabBtn"),
  localTabBtn: document.getElementById("localTabBtn"),
  onlineModeSection: document.getElementById("onlineModeSection"),
  localModeSection: document.getElementById("localModeSection"),
  playerCount: document.getElementById("playerCount"),
  botCount: document.getElementById("botCount"),
  roundCount: document.getElementById("roundCount"),
  onlineRoundCount: document.getElementById("onlineRoundCount"),
  playerNames: document.getElementById("playerNames"),
  startLocalBtn: document.getElementById("startLocalBtn"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  startOnlineBtn: document.getElementById("startOnlineBtn"),
  onlineName: document.getElementById("onlineName"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  onlineStatus: document.getElementById("onlineStatus"),
  voiceJoinBtn: document.getElementById("voiceJoinBtn"),
  voiceMuteBtn: document.getElementById("voiceMuteBtn"),
  voiceStatus: document.getElementById("voiceStatus"),
  lobbyPlayers: document.getElementById("lobbyPlayers"),
  lobbyBox: document.getElementById("lobbyBox"),
  setupError: document.getElementById("setupError"),
  roundLabel: document.getElementById("roundLabel"),
  turnLabel: document.getElementById("turnLabel"),
  phaseLabel: document.getElementById("phaseLabel"),
  drawCount: document.getElementById("drawCount"),
  previousDiscardVisual: document.getElementById("previousDiscardVisual"),
  previousDiscardMeta: document.getElementById("previousDiscardMeta"),
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
  online: {
    enabled: false,
    roomId: "",
    playerId: `p_${Math.random().toString(36).slice(2, 10)}`,
    isHost: false,
    unsubRoom: null,
    presenceRef: null,
    voice: {
      enabled: false,
      muted: false,
      localStream: null,
      peers: {},
      signalRef: null,
    },
  },
  lastShowPayload: null,
  leaveNotice: null,
  setupMode: "online",
};

let firebaseDb = null;
let lastSeenShowEventId = null;
let lastSeenLeaveNoticeId = null;

let dragFromIndex = null;
let audioCtx;


function initFirebase() {
  const services = window.firebaseServices;
  if (!services) {
    ui.onlineStatus.textContent = "Online mode disabled: firebase-init.js not loaded";
    return;
  }

  if (services.initError) {
    ui.onlineStatus.textContent = services.initError;
    return;
  }

  firebaseDb = services.database;
  ui.onlineStatus.textContent = "Firebase connected. Create or join a room.";
  setVoiceStatus("Voice: off");
}

function roomRef(roomId) {
  return firebaseDb.ref(`rooms/${roomId}`);
}

function randomRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function setOnlineStatus(msg) {
  ui.onlineStatus.textContent = msg;
}

function sanitizeRoomCode(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function setVoiceStatus(message) {
  if (ui.voiceStatus) ui.voiceStatus.textContent = message;
}

function supportsVoiceChat() {
  return typeof window.RTCPeerConnection === "function" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function voiceSignalInboxRef(roomId = state.online.roomId) {
  return roomRef(roomId).child(`voiceSignals/${state.online.playerId}`);
}

function cleanupVoicePeer(remoteId) {
  const peer = state.online.voice.peers[remoteId];
  if (!peer) return;
  if (peer.audioEl) peer.audioEl.remove();
  if (peer.pc) peer.pc.close();
  delete state.online.voice.peers[remoteId];
}

function leaveVoiceChat() {
  if (state.online.voice.signalRef) {
    state.online.voice.signalRef.off();
    state.online.voice.signalRef = null;
  }
  Object.keys(state.online.voice.peers).forEach(cleanupVoicePeer);
  if (state.online.voice.localStream) {
    state.online.voice.localStream.getTracks().forEach((track) => track.stop());
    state.online.voice.localStream = null;
  }
  state.online.voice.enabled = false;
  state.online.voice.muted = false;
  if (ui.voiceMuteBtn) {
    ui.voiceMuteBtn.disabled = true;
    ui.voiceMuteBtn.textContent = "Mute Mic";
  }
  if (ui.voiceJoinBtn) ui.voiceJoinBtn.textContent = "Join Voice Chat";
  setVoiceStatus("Voice: off");
}

function toggleVoiceMute() {
  if (!state.online.voice.localStream) return;
  state.online.voice.muted = !state.online.voice.muted;
  state.online.voice.localStream.getAudioTracks().forEach((track) => {
    track.enabled = !state.online.voice.muted;
  });
  if (ui.voiceMuteBtn) ui.voiceMuteBtn.textContent = state.online.voice.muted ? "Unmute Mic" : "Mute Mic";
  setVoiceStatus(state.online.voice.muted ? "Voice: connected (muted)" : "Voice: connected");
}

function sendVoiceSignal(toId, payload) {
  if (!state.online.roomId) return Promise.resolve();
  return roomRef(state.online.roomId).child(`voiceSignals/${toId}/${state.online.playerId}`).set({
    ...payload,
    updatedAt: Date.now(),
  });
}

async function ensureLocalVoiceStream() {
  if (state.online.voice.localStream) return state.online.voice.localStream;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  state.online.voice.localStream = stream;
  return stream;
}

async function ensureVoicePeer(remoteId, createOffer = false) {
  if (!remoteId || remoteId === state.online.playerId) return null;
  if (state.online.voice.peers[remoteId]) return state.online.voice.peers[remoteId];

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const stream = await ensureLocalVoiceStream();
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.playsInline = true;
  audioEl.dataset.peerId = remoteId;
  audioEl.style.display = "none";
  document.body.appendChild(audioEl);

  const peer = { pc, audioEl };
  state.online.voice.peers[remoteId] = peer;

  pc.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (remoteStream) audioEl.srcObject = remoteStream;
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendVoiceSignal(remoteId, { type: "candidate", candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    const stateName = pc.connectionState;
    if (stateName === "failed" || stateName === "closed" || stateName === "disconnected") {
      cleanupVoicePeer(remoteId);
    }
  };

  if (createOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendVoiceSignal(remoteId, { type: "offer", sdp: offer });
  }

  return peer;
}

async function handleVoiceSignal(fromId, signal) {
  if (!signal || !signal.type || fromId === state.online.playerId) return;
  const wantsOffer = signal.type !== "offer" && state.online.playerId < fromId;
  const peer = await ensureVoicePeer(fromId, wantsOffer);
  if (!peer) return;
  const { pc } = peer;

  if (signal.type === "offer" && signal.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendVoiceSignal(fromId, { type: "answer", sdp: answer });
    return;
  }

  if (signal.type === "answer" && signal.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    return;
  }

  if (signal.type === "candidate" && signal.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } catch (_error) {
      // Ignore stale ICE candidates for closed peers.
    }
  }
}

function subscribeVoiceSignals() {
  if (!state.online.roomId) return;
  if (state.online.voice.signalRef) state.online.voice.signalRef.off();
  const inboxRef = voiceSignalInboxRef();
  state.online.voice.signalRef = inboxRef;
  inboxRef.on("value", async (snap) => {
    const signals = snap.val() || {};
    for (const [fromId, signal] of Object.entries(signals)) {
      await handleVoiceSignal(fromId, signal);
      inboxRef.child(fromId).remove();
    }
  });
}

function syncVoicePeers(playersEntries) {
  if (!state.online.voice.enabled) return;
  const remoteIds = playersEntries.map(([id]) => id).filter((id) => id !== state.online.playerId);
  const remoteSet = new Set(remoteIds);

  Object.keys(state.online.voice.peers).forEach((id) => {
    if (!remoteSet.has(id)) cleanupVoicePeer(id);
  });

  remoteIds.forEach((id) => {
    if (!state.online.voice.peers[id]) {
      const createOffer = state.online.playerId < id;
      ensureVoicePeer(id, createOffer);
    }
  });
}

async function joinVoiceChat() {
  if (!supportsVoiceChat()) {
    setVoiceStatus("Voice unavailable in this browser.");
    return;
  }
  if (!state.online.enabled || !state.online.roomId) {
    setVoiceStatus("Join an online room first.");
    return;
  }
  if (state.online.voice.enabled) {
    leaveVoiceChat();
    return;
  }

  try {
    await ensureLocalVoiceStream();
    state.online.voice.enabled = true;
    state.online.voice.muted = false;
    if (ui.voiceJoinBtn) ui.voiceJoinBtn.textContent = "Leave Voice Chat";
    if (ui.voiceMuteBtn) {
      ui.voiceMuteBtn.disabled = false;
      ui.voiceMuteBtn.textContent = "Mute Mic";
    }
    setVoiceStatus("Voice: connecting...");
    await roomRef(state.online.roomId).child(`voicePresence/${state.online.playerId}`).set({
      name: ui.onlineName.value.trim() || "Player",
      joinedAt: Date.now(),
    });
    const presenceRef = roomRef(state.online.roomId).child(`voicePresence/${state.online.playerId}`);
    if (typeof presenceRef.onDisconnectRemove === "function") presenceRef.onDisconnectRemove();
    subscribeVoiceSignals();
    const snap = await roomRef(state.online.roomId).child("players").get();
    syncVoicePeers(Object.entries(snap.val() || {}));
    setVoiceStatus("Voice: connected");
  } catch (_error) {
    leaveVoiceChat();
    setVoiceStatus("Voice permission denied or unavailable.");
  }
}


function setupPresence(roomId) {
  const playerRef = roomRef(roomId).child(`players/${state.online.playerId}`);
  state.online.presenceRef = playerRef;
  if (typeof playerRef.onDisconnectRemove === "function") playerRef.onDisconnectRemove();
}

function maybeHandleLeaveNotice() {
  const notice = state.leaveNotice;
  if (!notice || !notice.id || notice.id === lastSeenLeaveNoticeId) return;
  lastSeenLeaveNoticeId = notice.id;
  logLine(notice.text);
}

function reconcileRoomDepartures(playersEntries) {
  const activeIds = new Set(playersEntries.map(([id]) => id));
  const removed = state.players.filter((p) => p.id && !activeIds.has(p.id));
  if (!removed.length) return;

  const names = removed.map((p) => p.name).join(", ");
  state.players = state.players.filter((p) => !p.id || activeIds.has(p.id));
  if (!state.players.length) return;

  if (state.currentPlayerIndex >= state.players.length) state.currentPlayerIndex = 0;
  const mine = myPlayerIndex();
  state.viewerIndex = mine >= 0 ? mine : 0;
  state.selectedHand = new Set();
  state.selectedPreviousIndex = null;

  const text = `${names} left the room. Game continues.`;
  const id = `leave_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  state.leaveNotice = { id, text };
  maybeHandleLeaveNotice();
  publishOnlineState();
}


function setSetupMode(mode) {
  state.setupMode = mode === "local" ? "local" : "online";
  const online = state.setupMode === "online";
  ui.onlineTabBtn.classList.toggle("active", online);
  ui.localTabBtn.classList.toggle("active", !online);
  ui.onlineTabBtn.setAttribute("aria-selected", String(online));
  ui.localTabBtn.setAttribute("aria-selected", String(!online));
  ui.onlineModeSection.classList.toggle("hidden", !online);
  ui.localModeSection.classList.toggle("hidden", online);
  ui.onlineModeSection.style.display = online ? "block" : "none";
  ui.localModeSection.style.display = online ? "none" : "block";
  ui.setupError.textContent = "";
}

function initSetupTabs() {
  ui.onlineTabBtn.addEventListener("click", () => setSetupMode("online"));
  ui.localTabBtn.addEventListener("click", () => setSetupMode("local"));
  setSetupMode("online");
}

function shouldWarnLeave() {
  return !ui.gamePanel.classList.contains("hidden") || state.online.enabled;
}

function initLeaveWarning() {
  const msg = "Are you sure you want to leave? Your current game progress may be lost.";
  window.addEventListener("beforeunload", (event) => {
    if (!shouldWarnLeave()) return;
    event.preventDefault();
    event.returnValue = msg;
  });

  history.pushState({ guard: true }, "", location.href);
  const onPopState = () => {
    if (!shouldWarnLeave()) return;
    const leave = window.confirm(msg);
    if (!leave) {
      history.pushState({ guard: true }, "", location.href);
      return;
    }
    window.removeEventListener("popstate", onPopState);
    history.back();
  };
  window.addEventListener("popstate", onPopState);
}


function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => value[k]);
  }
  return [];
}


function normalizeCardList(value) {
  return normalizeList(value).filter((c) => c && typeof c === "object" && c.rank);
}

function normalizePlayer(player) {
  if (!player || typeof player !== "object") return null;
  return {
    ...player,
    hand: normalizeCardList(player.hand),
    lastDiscard: normalizeCardList(player.lastDiscard),
    totalScore: Number(player.totalScore) || 0,
    name: player.name || "Player",
  };
}

function maybePlaySyncedShow() {
  const payload = state.lastShowPayload;
  if (!payload || !payload.eventId || payload.eventId === lastSeenShowEventId) return;
  lastSeenShowEventId = payload.eventId;
  const additionsByIndex = normalizeList(payload.additionsByIndex);
  openRevealModal(payload.showerIndex, payload.strictLowest, payload.reveal || [], additionsByIndex);
}

function myPlayerIndex() {
  return state.players.findIndex((p) => p.id === state.online.playerId);
}

function canCurrentHumanAct() {
  if (state.online.enabled) return !state.gameOver && currentPlayer().id === state.online.playerId;
  return !state.gameOver && currentPlayer().kind === "human";
}

function serializeGameState() {
  return JSON.parse(JSON.stringify({
    players: state.players,
    viewerIndex: state.viewerIndex,
    roundsTarget: state.roundsTarget,
    roundNumber: state.roundNumber,
    currentPlayerIndex: state.currentPlayerIndex,
    phase: state.phase,
    drawPile: state.drawPile,
    discardPool: state.discardPool,
    gameOver: state.gameOver,
    lastShowPayload: state.lastShowPayload,
    leaveNotice: state.leaveNotice,
  }));
}

function applyRemoteGameState(gameState) {
  state.players = normalizeList(gameState.players).map(normalizePlayer).filter(Boolean);
  state.viewerIndex = Number.isInteger(gameState.viewerIndex) ? gameState.viewerIndex : 0;
  state.roundsTarget = Number.isInteger(gameState.roundsTarget) ? gameState.roundsTarget : 1;
  state.roundNumber = Number.isInteger(gameState.roundNumber) ? gameState.roundNumber : 1;
  state.currentPlayerIndex = Number.isInteger(gameState.currentPlayerIndex) ? gameState.currentPlayerIndex : 0;
  state.phase = gameState.phase || "discard";
  state.drawPile = normalizeCardList(gameState.drawPile);
  state.discardPool = normalizeCardList(gameState.discardPool);
  state.gameOver = Boolean(gameState.gameOver);
  state.revealRunning = false;
  state.lastShowPayload = gameState.lastShowPayload || null;
  state.leaveNotice = gameState.leaveNotice || null;
  state.selectedHand = new Set();
  state.selectedPreviousIndex = null;
}

function publishOnlineState() {
  if (!state.online.enabled || !firebaseDb) return;
  roomRef(state.online.roomId).child("gameState").set(serializeGameState());
}


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
  const cardsNeeded = playerCount * 5 + Math.max(20, playerCount * 2);
  return Math.max(1, Math.ceil(cardsNeeded / 54));
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
  if (!Number.isInteger(state.roundNumber) || state.roundNumber < 1) state.roundNumber = 1;
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
  state.lastShowPayload = null;
  state.leaveNotice = null;
  logLine(`Round ${state.roundNumber} started.`);
}

function startGame() {
  const humanCount = Number(ui.playerCount.value);
  const botCount = Number(ui.botCount.value);
  const rounds = Number(ui.roundCount.value);

  if (!Number.isInteger(humanCount) || humanCount < 1 || humanCount > 20) return (ui.setupError.textContent = "Human players must be 1..20");
  if (!Number.isInteger(botCount) || botCount < 0 || botCount > 20) return (ui.setupError.textContent = "Bot players must be 0..20");
  if (humanCount + botCount < 2 || humanCount + botCount > 20) return (ui.setupError.textContent = "Total players must be 2..20");
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



function renderLobbyPlayers(players) {
  if (!ui.lobbyPlayers) return;
  ui.lobbyPlayers.innerHTML = "";
  players.forEach(([id, p]) => {
    const li = document.createElement("li");
    const me = id === state.online.playerId ? " (You)" : "";
    li.textContent = `${p.name || "Player"}${me}`;
    ui.lobbyPlayers.appendChild(li);
  });
}

async function createRoom() {
  if (!firebaseDb) return;
  const name = ui.onlineName.value.trim();
  if (!name) return setOnlineStatus("Enter your display name first.");
  const roomId = randomRoomCode();
  state.online.roomId = roomId;
  state.online.enabled = true;
  state.online.isHost = true;
  ui.roomCodeInput.value = roomId;

  const room = roomRef(roomId);
  await room.set({
    hostId: state.online.playerId,
    status: "lobby",
    createdAt: Date.now(),
    players: {
      [state.online.playerId]: { name, joinedAt: Date.now() },
    },
  });
  setupPresence(roomId);
  subscribeRoom(roomId);
  setOnlineStatus(`Room ${roomId} created. Share this code with friends.`);
}

async function joinRoom() {
  if (!firebaseDb) return;
  const name = ui.onlineName.value.trim();
  if (!name) return setOnlineStatus("Enter your display name first.");
  const roomId = sanitizeRoomCode(ui.roomCodeInput.value);
  if (!roomId) return setOnlineStatus("Enter a valid room code.");

  const room = roomRef(roomId);
  const snap = await room.get();
  if (!snap.exists()) return setOnlineStatus("Room not found.");

  await room.child(`players/${state.online.playerId}`).set({ name, joinedAt: Date.now() });
  state.online.roomId = roomId;
  state.online.enabled = true;
  state.online.isHost = snap.val().hostId === state.online.playerId;
  setupPresence(roomId);
  subscribeRoom(roomId);
  setOnlineStatus(`Joined room ${roomId}. Waiting for host to start.`);
}

function subscribeRoom(roomId) {
  if (state.online.unsubRoom) state.online.unsubRoom.off();
  const ref = roomRef(roomId);
  state.online.unsubRoom = ref;
  ref.on("value", (snap) => {
    const room = snap.val();
    if (!room) return;

    const players = Object.entries(room.players || {});
    renderLobbyPlayers(players);
    syncVoicePeers(players);
    if (room.status === "lobby") setOnlineStatus(`Lobby: ${players.length} player(s) in room ${roomId}`);
    ui.startOnlineBtn.disabled = !(state.online.isHost && players.length >= 2 && room.status === "lobby");

    if (room.gameState) {
      applyRemoteGameState(room.gameState);
      const mine = myPlayerIndex();
      if (mine >= 0) state.viewerIndex = mine;
      ui.setupPanel.classList.add("hidden");
      ui.gamePanel.classList.remove("hidden");
      reconcileRoomDepartures(players);
      render();
      maybePlaySyncedShow();
      maybeHandleLeaveNotice();
    }
  });
}

async function startOnlineGame() {
  if (!state.online.enabled || !state.online.isHost) return;
  const roomId = state.online.roomId;
  const snap = await roomRef(roomId).child("players").get();
  const allPlayers = Object.entries(snap.val() || {});
  if (allPlayers.length < 2) return setOnlineStatus("Need at least 2 players to start.");

  state.players = allPlayers.map(([id, p]) => ({
    id,
    name: p.name,
    kind: "human",
    avatar: avatarForName(p.name),
    hand: [],
    totalScore: 0,
    lastDiscard: [],
  }));
  state.viewerIndex = myPlayerIndex();
  const onlineRounds = Number(ui.onlineRoundCount?.value);
  state.roundsTarget = Number.isInteger(onlineRounds) && onlineRounds >= 1 && onlineRounds <= 20 ? onlineRounds : 5;
  state.roundNumber = 1;
  state.gameOver = false;
  state.revealRunning = false;
  ui.logBox.innerHTML = "";
  ui.resultPanel.classList.add("hidden");
  startRound();
  ui.setupPanel.classList.add("hidden");
  ui.gamePanel.classList.remove("hidden");
  await roomRef(roomId).update({ status: "playing", gameState: serializeGameState() });
  setOnlineStatus(`Match started with ${allPlayers.length} players in room ${roomId}.`);
}


function currentPlayer() {
  return state.players[state.currentPlayerIndex];
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
  publishOnlineState();
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
  publishOnlineState();
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
  publishOnlineState();
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
  publishOnlineState();
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
  publishOnlineState();
}

function resolveShow(showerIndex) {
  const shower = state.players[showerIndex];
  const showerPts = handPoints(shower.hand);
  const strictLowest = state.players.every((p, i) => i === showerIndex || showerPts < handPoints(p.hand));

  const additionsByIndex = [];
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
    additionsByIndex[i] = add;
    return {
      index: i,
      name: p.name,
      points: pts,
      hand: p.hand.map((c) => ({ ...c })),
      handSorted: [...p.hand].sort(cardTie).map((c) => ({ ...c })),
      total: p.totalScore,
    };
  });

  const eventId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  state.lastShowPayload = {
    eventId,
    showerIndex,
    strictLowest,
    reveal,
    additionsByIndex,
  };
  lastSeenShowEventId = eventId;
  playSfx("show");
  openRevealModal(showerIndex, strictLowest, reveal, additionsByIndex);
}

async function openRevealModal(showerIndex, strictLowest, reveal, additionsByIndex) {
  if (state.revealRunning) return;
  state.revealRunning = true;

  const shower = state.players[showerIndex];
  const showerEntry = reveal.find((r) => r.index === showerIndex);
  const others = reveal.filter((r) => r.index !== showerIndex).sort((a, b) => a.points - b.points);
  const sorted = showerEntry ? [showerEntry, ...others] : others;

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
    const addValue = additionsByIndex[r.index] ?? 0;
    col.querySelector(".reveal-add strong").textContent = `+${addValue}`;
    col.querySelector(".reveal-total strong").textContent = String(r.total);
  };

  for (const r of sorted) await revealOne(r, 220);

  const viewerAdd = additionsByIndex[state.viewerIndex] ?? 0;
  if (viewerAdd === 0) {
    ui.resultPanel.classList.add("result-win");
    ui.resultFx.innerHTML = '<div class="fx-win"><img alt="Fireworks" src="https://media.giphy.com/media/26tOZ42Mg6pbTUPHW/giphy.gif" /></div><p class="win-text">You WON this round! (+0)</p>';
  } else if (viewerAdd === 50) {
    ui.resultPanel.classList.add("result-lose");
    ui.resultFx.innerHTML = '<div class="fx-lose"><img alt="Sad" src="https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif" /></div><p class="lose-text">You LOST this round. (+50)</p>';
  } else {
    ui.resultFx.innerHTML = `<p class="reveal-title">Round Add: +${viewerAdd}</p>`;
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


function showFinalWinnerModal() {
  const ranked = [...state.players].sort((a, b) => a.totalScore - b.totalScore);
  const winner = ranked[0];
  ui.modalTitle.textContent = `Game Winner: ${winner.name}`;
  ui.resultPanel.classList.remove("hidden", "result-lose");
  ui.resultPanel.classList.add("result-win");
  ui.revealBox.innerHTML = `<p class="reveal-title">Final Standings</p>${ranked
    .map((p, i) => `<p><strong>#${i + 1}</strong> ${p.name} — Total: ${p.totalScore}</p>`)
    .join("")}`;
  ui.resultFx.innerHTML = `<div class="fx-win"><img alt="Fireworks" src="https://media.giphy.com/media/26tOZ42Mg6pbTUPHW/giphy.gif" /></div><p class="win-text">${winner.name} finished 1st and wins the game!</p>`;
  ui.nextRoundBtn.textContent = "Close";
  ui.nextRoundBtn.disabled = false;
}

function nextRound() {
  if (state.gameOver) {
    ui.resultPanel.classList.remove("result-win", "result-lose");
    ui.resultPanel.classList.add("hidden");
    render();
    return;
  }
  ui.resultPanel.classList.remove("result-win", "result-lose");
  ui.resultPanel.classList.add("hidden");
  if (state.roundNumber >= state.roundsTarget) {
    state.gameOver = true;
    const winner = [...state.players].sort((a, b) => a.totalScore - b.totalScore)[0];
    logLine(`Game over. Winner: ${winner.name} (${winner.totalScore}).`);
    showFinalWinnerModal();
    render();
    return;
  }

  state.roundNumber += 1;
  startRound();
  render();
  publishOnlineState();
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
  if (!state.online.enabled && cp.kind === "human") state.viewerIndex = state.currentPlayerIndex;
  const viewer = state.players[state.viewerIndex] || cp;
  const viewerTurn = canCurrentHumanAct();
  const prevIdx = previousPlayerIndex();
  const prevGroup = previousDiscardGroup();

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

  ui.playerStrip.innerHTML = "";
  state.players.forEach((p, i) => {
    const chip = document.createElement("article");
    const isPrev = i === prevIdx;
    chip.className = `player-chip ${i === state.currentPlayerIndex ? "current" : ""} ${isPrev ? "prev-highlight" : ""}`;
    const last = p.lastDiscard.length ? p.lastDiscard.map(renderCardText).join(" ") : "none";
    const miniBacks = Array.from({ length: Math.min(p.hand.length, 8) }).map(() => '<span class="mini-back"></span>').join("");
    const turnBadge = i === state.currentPlayerIndex ? `<span class="turn-badge">ACTIVE TURN</span>` : "";
    chip.innerHTML = `
      <div class="player-head">
        <span class="player-avatar">${p.kind === "bot" ? "🤖" : p.avatar}</span>
        <strong>${p.name}${p.kind === "bot" ? " [BOT]" : ""}</strong>
        ${turnBadge}
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


ui.createRoomBtn.addEventListener("click", createRoom);
ui.joinRoomBtn.addEventListener("click", joinRoom);
ui.startOnlineBtn.addEventListener("click", startOnlineGame);
ui.voiceJoinBtn?.addEventListener("click", joinVoiceChat);
ui.voiceMuteBtn?.addEventListener("click", toggleVoiceMute);

window.addEventListener("beforeunload", () => {
  leaveVoiceChat();
});

initSetupTabs();
initLeaveWarning();
initFirebase();
if (!supportsVoiceChat()) {
  if (ui.voiceJoinBtn) ui.voiceJoinBtn.disabled = true;
  if (ui.voiceMuteBtn) ui.voiceMuteBtn.disabled = true;
  setVoiceStatus("Voice unavailable in this browser.");
}
