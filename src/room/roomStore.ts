import type { Server as SocketIOServer } from "socket.io";
import { AppError } from "../middleware/response.js";
import {
  BoardState,
  PlayerSymbol,
  createEmptyBoard,
  checkWin,
  isBoardFull,
  getAvailableCells,
} from "../game/board.js";

export type GameStatus =
  | "WAITING"
  | "COUNTDOWN"
  | "PLAYING"
  | "FINISHED"
  | "REMATCH_PENDING";

export interface RoomPlayer {
  playerId: string;
  name: string;
  displayName: string;
  symbol: PlayerSymbol | null;
  isCreator: boolean;
  connected: boolean;
  socketId?: string;
  left?: boolean;
  reconnectTimer?: NodeJS.Timeout;
}

export interface RematchState {
  requestedBy: string; // playerId of requester
  requestedAt: number;
  expiresAt: number;
  timer?: NodeJS.Timeout;
}

export interface Room {
  code: string;
  players: RoomPlayer[];
  gameStatus: GameStatus;
  createdAt: number;
  expiresAt: number; // For WAITING rooms (10 minutes)
  expirationTimer?: NodeJS.Timeout;
  winnerPlayerId?: string | "DRAW" | null;
  winReason?: "NORMAL" | "ABANDONMENT" | "DRAW" | null;

  // Game Engine State
  board: BoardState;
  currentTurn: string | null; // playerId whose turn it is
  turnTimer?: NodeJS.Timeout;
  turnInterval?: NodeJS.Timeout;
  turnStartedAt?: number;
  turnTimeRemaining: number; // in seconds (0 to 30)

  // Countdown State
  countdownTimer?: NodeJS.Timeout;

  // Rematch State
  rematch: RematchState | null;
}

// 5 uppercase alphanumeric characters excluding O, 0, I, and 1
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;
export const WAITING_ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const TURN_DURATION_SEC = 30;
export const RECONNECT_GRACE_PERIOD_MS = 60 * 1000; // 60 seconds
export const REMATCH_EXPIRATION_MS = 30 * 1000; // 30 seconds

// In-memory rooms store: roomCode -> Room
const rooms = new Map<string, Room>();

// Player to room mapping for fast lookup: playerId -> roomCode
const playerToRoom = new Map<string, string>();

export const generateRoomCode = (): string => {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
      code += ROOM_CODE_ALPHABET[idx];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }
  throw new Error("Unable to generate unique room code");
};

export const normalizeRoomCode = (code: string): string => {
  return code.trim().toUpperCase();
};

export const getRoom = (code: string): Room | null => {
  const normalized = normalizeRoomCode(code);
  const room = rooms.get(normalized);
  if (!room) return null;

  // Check expiration if WAITING
  if (room.gameStatus === "WAITING" && Date.now() > room.expiresAt) {
    expireRoom(normalized);
    return null;
  }

  return room;
};

export const getPlayerRoom = (playerId: string): Room | null => {
  const code = playerToRoom.get(playerId);
  if (!code) return null;
  return getRoom(code);
};

// Recompute room-specific display names without mutating original session names.
export const refreshDisplayNames = (players: RoomPlayer[]): void => {
  const nameCounts = new Map<string, number>();

  for (const player of players) {
    const normalizedName = player.name.trim();
    const count = (nameCounts.get(normalizedName) ?? 0) + 1;
    nameCounts.set(normalizedName, count);
    player.displayName = count === 1 ? player.name : `${player.name}${count}`;
  }
};

export const clearTurnTimers = (room: Room): void => {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = undefined;
  }
  if (room.turnInterval) {
    clearInterval(room.turnInterval);
    room.turnInterval = undefined;
  }
};

export const clearCountdownTimer = (room: Room): void => {
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = undefined;
  }
};

export const clearRematchTimer = (room: Room): void => {
  if (room.rematch?.timer) {
    clearTimeout(room.rematch.timer);
    room.rematch.timer = undefined;
  }
  room.rematch = null;
};

export const clearAllRoomTimers = (room: Room): void => {
  if (room.expirationTimer) {
    clearTimeout(room.expirationTimer);
    room.expirationTimer = undefined;
  }
  clearTurnTimers(room);
  clearCountdownTimer(room);
  clearRematchTimer(room);
  for (const player of room.players) {
    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = undefined;
    }
  }
};

export const createRoom = (
  playerId: string,
  playerName: string,
  io?: SocketIOServer
): Room => {
  const existingRoom = getPlayerRoom(playerId);
  if (existingRoom) {
    if (existingRoom.gameStatus === "WAITING") {
      leaveRoom(playerId, io);
    }
  }

  const code = generateRoomCode();
  const createdAt = Date.now();
  const expiresAt = createdAt + WAITING_ROOM_TTL_MS;

  const room: Room = {
    code,
    players: [
      {
        playerId,
        name: playerName,
        displayName: playerName,
        symbol: null,
        isCreator: true,
        connected: false,
      },
    ],
    gameStatus: "WAITING",
    createdAt,
    expiresAt,
    winnerPlayerId: null,
    winReason: null,
    board: createEmptyBoard(),
    currentTurn: null,
    turnTimeRemaining: TURN_DURATION_SEC,
    rematch: null,
  };

  room.expirationTimer = setTimeout(() => {
    expireRoom(code, io);
  }, WAITING_ROOM_TTL_MS);

  rooms.set(code, room);
  playerToRoom.set(playerId, code);

  console.log(`Room created: ${code} by player: ${playerId} (${playerName})`);

  return room;
};

export const joinRoom = (
  code: string,
  playerId: string,
  playerName: string,
  io?: SocketIOServer
): Room => {
  const normalized = normalizeRoomCode(code);
  const room = rooms.get(normalized);

  if (!room) {
    throw new AppError(404, "Room not found.", "ROOM_NOT_FOUND");
  }

  if (room.gameStatus === "WAITING" && Date.now() > room.expiresAt) {
    expireRoom(normalized, io);
    throw new AppError(410, "Room has expired.", "ROOM_EXPIRED");
  }

  const existingPlayer = room.players.find((p) => p.playerId === playerId);
  if (existingPlayer) {
    return room;
  }

  if (room.players.length >= 2) {
    throw new AppError(400, "Room is full.", "ROOM_FULL");
  }

  // Handle previous rooms if player was elsewhere
  const currentRoom = getPlayerRoom(playerId);
  if (currentRoom && currentRoom.code !== normalized) {
    leaveRoom(playerId, io);
  }

  // Cancel waiting room expiration timer
  if (room.expirationTimer) {
    clearTimeout(room.expirationTimer);
    room.expirationTimer = undefined;
  }

  const newPlayer: RoomPlayer = {
    playerId,
    name: playerName,
    displayName: playerName,
    symbol: null,
    isCreator: false,
    connected: false,
  };

  room.players.push(newPlayer);
  refreshDisplayNames(room.players);
  playerToRoom.set(playerId, normalized);

  console.log(`Player joined room ${normalized}: ${playerId} (${newPlayer.displayName})`);

  // Transition to COUNTDOWN and start sequence
  if (io) {
    startCountdown(room, io);
  } else {
    room.gameStatus = "COUNTDOWN";
  }

  return room;
};

export const startCountdown = (room: Room, io: SocketIOServer): void => {
  clearTurnTimers(room);
  clearCountdownTimer(room);
  clearRematchTimer(room);

  room.gameStatus = "COUNTDOWN";
  room.board = createEmptyBoard();
  room.winnerPlayerId = null;
  room.winReason = null;
  room.currentTurn = null;

  // Random assignment of X and O
  const isP1X = Math.random() < 0.5;
  room.players[0].symbol = isP1X ? "X" : "O";
  room.players[1].symbol = isP1X ? "O" : "X";

  refreshDisplayNames(room.players);

  console.log(`Starting countdown for room ${room.code}. Assignments: ${room.players[0].displayName}=${room.players[0].symbol}, ${room.players[1].displayName}=${room.players[1].symbol}`);

  // Broadcast initial room update
  broadcastRoomState(room, io);

  let seconds = 3;
  io.to(room.code).emit("game:countdown", { count: seconds });

  const runTick = () => {
    seconds--;
    if (seconds > 0) {
      io.to(room.code).emit("game:countdown", { count: seconds });
      room.countdownTimer = setTimeout(runTick, 1000);
    } else {
      // Countdown finished -> PLAYING
      room.countdownTimer = undefined;
      startGame(room, io);
    }
  };

  room.countdownTimer = setTimeout(runTick, 1000);
};

export const startGame = (room: Room, io: SocketIOServer): void => {
  room.gameStatus = "PLAYING";

  // Player with symbol 'X' goes first
  const playerX = room.players.find((p) => p.symbol === "X");
  room.currentTurn = playerX ? playerX.playerId : room.players[0].playerId;

  console.log(`Game started in room ${room.code}. First turn: player ${room.currentTurn}`);

  broadcastGameState(room, io);
  startTurnTimer(room, io);
};

export const startTurnTimer = (room: Room, io: SocketIOServer): void => {
  clearTurnTimers(room);

  room.turnTimeRemaining = TURN_DURATION_SEC;
  room.turnStartedAt = Date.now();

  // Tick interval every second to keep clients in sync
  room.turnInterval = setInterval(() => {
    if (room.turnTimeRemaining > 0) {
      room.turnTimeRemaining--;
      broadcastGameState(room, io);
    }
  }, 1000);

  room.turnTimer = setTimeout(() => {
    handleTurnTimeout(room, io);
  }, TURN_DURATION_SEC * 1000);
};

export const handleTurnTimeout = (room: Room, io: SocketIOServer): void => {
  clearTurnTimers(room);

  if (room.gameStatus !== "PLAYING" || !room.currentTurn) {
    return;
  }

  const availableCells = getAvailableCells(room.board);
  if (availableCells.length === 0) {
    return;
  }

  // Randomly select one available cell
  const randomIndex = Math.floor(Math.random() * availableCells.length);
  const cellIndex = availableCells[randomIndex];

  const currentTurnPlayer = room.currentTurn;
  makeMove(room, currentTurnPlayer, cellIndex, io);
};

export const makeMove = (
  room: Room,
  playerId: string,
  cellIndex: number,
  io: SocketIOServer
): boolean => {
  // Server-authoritative validation
  if (room.gameStatus !== "PLAYING") return false;
  if (room.currentTurn !== playerId) return false;
  if (cellIndex < 0 || cellIndex > 8 || !Number.isInteger(cellIndex)) return false;
  if (room.board[cellIndex] !== null) return false;

  const player = room.players.find((p) => p.playerId === playerId);
  if (!player || !player.symbol) return false;

  // Apply move
  room.board[cellIndex] = player.symbol;
  clearTurnTimers(room);

  // Check win condition
  if (checkWin(room.board, player.symbol)) {
    room.gameStatus = "FINISHED";
    room.winnerPlayerId = playerId;
    room.winReason = "NORMAL";
    room.currentTurn = null;

    console.log(`Game finished in room ${room.code}: winner is player ${playerId} (${player.displayName})`);

    broadcastGameState(room, io);
    io.to(room.code).emit("game:finished", {
      winner: playerId,
      winReason: "NORMAL",
      room: sanitizeRoom(room),
    });
    return true;
  }

  // Check draw condition
  if (isBoardFull(room.board)) {
    room.gameStatus = "FINISHED";
    room.winnerPlayerId = "DRAW";
    room.winReason = "DRAW";
    room.currentTurn = null;

    console.log(`Game finished in room ${room.code}: DRAW`);

    broadcastGameState(room, io);
    io.to(room.code).emit("game:finished", {
      winner: "DRAW",
      winReason: "DRAW",
      room: sanitizeRoom(room),
    });
    return true;
  }

  // Switch turn to opponent
  const opponent = room.players.find((p) => p.playerId !== playerId);
  room.currentTurn = opponent ? opponent.playerId : null;

  broadcastGameState(room, io);
  startTurnTimer(room, io);
  return true;
};

export const requestRematch = (
  room: Room,
  playerId: string,
  io: SocketIOServer
): boolean => {
  if (room.gameStatus !== "FINISHED") return false;

  // Cannot request if a player has already left
  if (room.players.some((p) => p.left)) return false;

  // Prevent duplicate rematch requests
  if (room.rematch) return false;

  const requester = room.players.find((p) => p.playerId === playerId);
  if (!requester) return false;

  const now = Date.now();
  const expiresAt = now + REMATCH_EXPIRATION_MS;

  room.gameStatus = "REMATCH_PENDING";
  room.rematch = {
    requestedBy: playerId,
    requestedAt: now,
    expiresAt,
  };

  room.rematch.timer = setTimeout(() => {
    // If request expires -> delete room
    io.to(room.code).emit("rematch:expired", { code: room.code });
    deleteRoom(room.code, io);
  }, REMATCH_EXPIRATION_MS);

  io.to(room.code).emit("rematch:requested", {
    requestedBy: playerId,
    expiresInMs: REMATCH_EXPIRATION_MS,
  });

  broadcastRoomState(room, io);
  return true;
};

export const acceptRematch = (
  room: Room,
  playerId: string,
  io: SocketIOServer
): boolean => {
  if (room.gameStatus !== "REMATCH_PENDING" || !room.rematch) return false;
  if (room.rematch.requestedBy === playerId) return false; // Must be accepted by the other player

  clearRematchTimer(room);

  io.to(room.code).emit("rematch:accepted", {
    acceptedBy: playerId,
  });

  // Start countdown for new game
  startCountdown(room, io);
  return true;
};

export const declineRematch = (
  room: Room,
  playerId: string,
  io: SocketIOServer
): boolean => {
  if (room.gameStatus !== "REMATCH_PENDING" || !room.rematch) return false;

  clearRematchTimer(room);

  io.to(room.code).emit("rematch:declined", {
    declinedBy: playerId,
  });

  // If declined -> delete room
  deleteRoom(room.code, io);
  return true;
};

export const leaveRoom = (
  playerId: string,
  io?: SocketIOServer
): { roomDeleted: boolean; room: Room | null } => {
  const code = playerToRoom.get(playerId);
  if (!code) {
    throw new AppError(404, "You are not in a room.", "NOT_IN_ROOM");
  }

  const room = rooms.get(code);
  if (!room) {
    playerToRoom.delete(playerId);
    throw new AppError(404, "Room not found.", "ROOM_NOT_FOUND");
  }

  // If waiting for Player 2: delete room immediately
  if (room.gameStatus === "WAITING") {
    clearAllRoomTimers(room);
    rooms.delete(code);
    playerToRoom.delete(playerId);
    return { roomDeleted: true, room: null };
  }

  // If rematch pending and requester leaves before response -> delete room
  if (room.gameStatus === "REMATCH_PENDING") {
    if (io) {
      io.to(code).emit("player:left", { playerId, roomDeleted: true });
    }
    deleteRoom(code, io);
    return { roomDeleted: true, room: null };
  }

  // If game is active (COUNTDOWN or PLAYING): opponent wins by abandonment
  if (room.gameStatus === "COUNTDOWN" || room.gameStatus === "PLAYING") {
    clearTurnTimers(room);
    clearCountdownTimer(room);

    const opponent = room.players.find((p) => p.playerId !== playerId);
    room.gameStatus = "FINISHED";
    room.winnerPlayerId = opponent ? opponent.playerId : null;
    room.winReason = "ABANDONMENT";
    room.currentTurn = null;

    const leavingPlayer = room.players.find((p) => p.playerId === playerId);
    if (leavingPlayer) {
      leavingPlayer.left = true;
    }

    playerToRoom.delete(playerId);

    if (io) {
      io.to(code).emit("player:left", {
        playerId,
        winnerPlayerId: room.winnerPlayerId,
        winReason: room.winReason,
        room: sanitizeRoom(room),
      });
      broadcastGameState(room, io);
    }

    const remainingActivePlayers = room.players.filter((p) => !p.left);
    if (remainingActivePlayers.length === 0) {
      clearAllRoomTimers(room);
      rooms.delete(code);
      return { roomDeleted: true, room: null };
    }

    return { roomDeleted: false, room };
  }

  // If game has already finished: leaving closes room for that player; no rematch for that player
  if (room.gameStatus === "FINISHED") {
    clearRematchTimer(room);

    const leavingPlayer = room.players.find((p) => p.playerId === playerId);
    if (leavingPlayer) {
      leavingPlayer.left = true;
    }

    playerToRoom.delete(playerId);

    if (io) {
      io.to(code).emit("player:left", {
        playerId,
        room: sanitizeRoom(room),
      });
    }

    const remainingActivePlayers = room.players.filter((p) => !p.left);
    if (remainingActivePlayers.length === 0) {
      clearAllRoomTimers(room);
      rooms.delete(code);
      return { roomDeleted: true, room: null };
    }

    return { roomDeleted: false, room };
  }

  return { roomDeleted: false, room };
};

export const handlePlayerDisconnect = (
  playerId: string,
  socketId: string,
  io: SocketIOServer
): void => {
  const room = getPlayerRoom(playerId);
  if (!room) return;

  const player = room.players.find((p) => p.playerId === playerId);
  if (!player || player.socketId !== socketId) return;

  player.connected = false;
  player.socketId = undefined;

  io.to(room.code).emit("player:disconnected", {
    playerId,
    name: player.displayName,
  });

  // Start 60-second reconnect grace period if game is in progress, countdown, or rematch pending
  if (
    room.gameStatus === "PLAYING" ||
    room.gameStatus === "COUNTDOWN" ||
    room.gameStatus === "REMATCH_PENDING"
  ) {
    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
    }

    player.reconnectTimer = setTimeout(() => {
      handleDisconnectTimeout(room.code, playerId, io);
    }, RECONNECT_GRACE_PERIOD_MS);
  }
};

export const handleDisconnectTimeout = (
  code: string,
  playerId: string,
  io: SocketIOServer
): void => {
  const room = rooms.get(code);
  if (!room) return;

  const player = room.players.find((p) => p.playerId === playerId);
  if (!player || player.connected) return;

  player.left = true;
  playerToRoom.delete(playerId);

  // Connected player wins by abandonment
  const connectedPlayer = room.players.find((p) => p.connected && !p.left);
  clearTurnTimers(room);
  clearCountdownTimer(room);
  clearRematchTimer(room);

  room.gameStatus = "FINISHED";
  room.winnerPlayerId = connectedPlayer ? connectedPlayer.playerId : null;
  room.winReason = "ABANDONMENT";
  room.currentTurn = null;

  io.to(code).emit("game:finished", {
    winner: room.winnerPlayerId,
    winReason: "ABANDONMENT",
    room: sanitizeRoom(room),
  });

  broadcastGameState(room, io);

  const remaining = room.players.filter((p) => !p.left);
  if (remaining.length === 0) {
    deleteRoom(code, io);
  }
};

export const handlePlayerReconnect = (
  room: Room,
  playerId: string,
  socketId: string,
  io: SocketIOServer
): void => {
  const player = room.players.find((p) => p.playerId === playerId);
  if (!player) return;

  if (player.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = undefined;
  }

  player.connected = true;
  player.socketId = socketId;

  io.to(room.code).emit("player:connected", {
    playerId,
    name: player.displayName,
  });

  // Broadcast full current state immediately
  broadcastGameState(room, io);
};

export const expireRoom = (code: string, io?: SocketIOServer): void => {
  const room = rooms.get(code);
  if (!room) return;

  clearAllRoomTimers(room);

  if (io) {
    io.to(code).emit("room:expired", {
      code,
      message: "Room expired due to inactivity.",
    });
  }

  for (const player of room.players) {
    if (playerToRoom.get(player.playerId) === code) {
      playerToRoom.delete(player.playerId);
    }
  }

  rooms.delete(code);
  console.log(`Room expired and deleted: ${code}`);
};

export const deleteRoom = (code: string, io?: SocketIOServer): void => {
  const room = rooms.get(code);
  if (!room) return;

  clearAllRoomTimers(room);

  for (const player of room.players) {
    if (playerToRoom.get(player.playerId) === code) {
      playerToRoom.delete(player.playerId);
    }
  }

  rooms.delete(code);
  console.log(`Room deleted: ${code}`);
};

// Client-facing Player Information
export interface ClientPlayerInfo {
  playerId: string;
  name: string;
  symbol: PlayerSymbol | null;
  isConnected: boolean;
  isMyTurn: boolean;
}

export interface ClientGameState {
  code: string;
  gameStatus: GameStatus;
  board: BoardState;
  players: ClientPlayerInfo[];
  currentTurn: string | null;
  winner: string | "DRAW" | null;
  turnTimeRemaining: number;
  connectionState: {
    allConnected: boolean;
  };
  rematch: {
    requestedBy: string;
    expiresAt: number;
  } | null;
}

export const getClientGameState = (room: Room): ClientGameState => {
  const players: ClientPlayerInfo[] = room.players.map((p) => ({
    playerId: p.playerId,
    name: p.displayName,
    symbol: p.symbol,
    isConnected: p.connected,
    isMyTurn: room.gameStatus === "PLAYING" && room.currentTurn === p.playerId,
  }));

  return {
    code: room.code,
    gameStatus: room.gameStatus,
    board: room.board,
    players,
    currentTurn: room.currentTurn,
    winner: room.winnerPlayerId || null,
    turnTimeRemaining: room.turnTimeRemaining,
    connectionState: {
      allConnected: room.players.every((p) => p.connected),
    },
    rematch: room.rematch
      ? {
          requestedBy: room.rematch.requestedBy,
          expiresAt: room.rematch.expiresAt,
        }
      : null,
  };
};

export const broadcastGameState = (room: Room, io: SocketIOServer): void => {
  const state = getClientGameState(room);
  for (const player of room.players) {
    if (player.socketId) {
      io.to(player.socketId).emit("game:state", state);
    }
  }
};

export const broadcastRoomState = (room: Room, io: SocketIOServer): void => {
  io.to(room.code).emit("room:updated", {
    room: sanitizeRoom(room),
  });
  broadcastGameState(room, io);
};

export const sanitizeRoom = (room: Room) => {
  const {
    expirationTimer,
    turnTimer,
    turnInterval,
    turnStartedAt,
    countdownTimer,
    ...safeRoom
  } = room;

  const safePlayers = room.players.map(({ reconnectTimer, ...p }) => p);
  const safeRematch = room.rematch
    ? {
        requestedBy: room.rematch.requestedBy,
        requestedAt: room.rematch.requestedAt,
        expiresAt: room.rematch.expiresAt,
      }
    : null;

  return {
    ...safeRoom,
    players: safePlayers,
    rematch: safeRematch,
  };
};
