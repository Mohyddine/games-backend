import { AppError } from "../middleware/response.js";
import { createEmptyBoard, checkWin, isBoardFull, getAvailableCells, } from "../game/board.js";
import { getRpsWinner, isRpsChoice, } from "../game/rockPaperScissors.js";
// 5 uppercase alphanumeric characters excluding O, 0, I, and 1
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;
export const WAITING_ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const TURN_DURATION_SEC = 30;
export const RECONNECT_GRACE_PERIOD_MS = 60 * 1000; // 60 seconds
export const REMATCH_EXPIRATION_MS = 30 * 1000; // 30 seconds
export const RPS_ROUND_TRANSITION_MS = 2 * 1000;
// In-memory rooms store: roomCode -> Room
const rooms = new Map();
// Player to room mapping for fast lookup: playerId -> roomCode
const playerToRoom = new Map();
export const generateRoomCode = () => {
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
export const normalizeRoomCode = (code) => {
    return code.trim().toUpperCase();
};
export const getRoom = (code) => {
    const normalized = normalizeRoomCode(code);
    const room = rooms.get(normalized);
    if (!room)
        return null;
    // Check expiration if WAITING
    if (room.gameStatus === "WAITING" && Date.now() > room.expiresAt) {
        expireRoom(normalized);
        return null;
    }
    return room;
};
export const getPlayerRoom = (playerId) => {
    const code = playerToRoom.get(playerId);
    if (!code)
        return null;
    return getRoom(code);
};
// Recompute room-specific display names without mutating original session names.
export const refreshDisplayNames = (players) => {
    const nameCounts = new Map();
    for (const player of players) {
        const normalizedName = player.name.trim();
        const count = (nameCounts.get(normalizedName) ?? 0) + 1;
        nameCounts.set(normalizedName, count);
        player.displayName = count === 1 ? player.name : `${player.name}${count}`;
    }
};
export const clearTurnTimers = (room) => {
    if (room.turnTimer) {
        clearTimeout(room.turnTimer);
        room.turnTimer = undefined;
    }
    if (room.turnInterval) {
        clearInterval(room.turnInterval);
        room.turnInterval = undefined;
    }
};
export const clearCountdownTimer = (room) => {
    if (room.countdownTimer) {
        clearTimeout(room.countdownTimer);
        room.countdownTimer = undefined;
    }
};
export const clearRpsTransitionTimer = (room) => {
    if (room.rpsTransitionTimer) {
        clearTimeout(room.rpsTransitionTimer);
        room.rpsTransitionTimer = undefined;
    }
};
export const clearRematchTimer = (room) => {
    if (room.rematch?.timer) {
        clearTimeout(room.rematch.timer);
        room.rematch.timer = undefined;
    }
    room.rematch = null;
};
export const clearAllRoomTimers = (room) => {
    if (room.expirationTimer) {
        clearTimeout(room.expirationTimer);
        room.expirationTimer = undefined;
    }
    clearTurnTimers(room);
    clearCountdownTimer(room);
    clearRpsTransitionTimer(room);
    clearRematchTimer(room);
    for (const player of room.players) {
        if (player.reconnectTimer) {
            clearTimeout(player.reconnectTimer);
            player.reconnectTimer = undefined;
        }
    }
};
export const createRoom = (playerId, playerName, gameType, totalRoundsOrIo, io) => {
    const totalRounds = typeof totalRoundsOrIo === "number" ? totalRoundsOrIo : undefined;
    const socketServer = typeof totalRoundsOrIo === "number" ? io : totalRoundsOrIo;
    if (gameType === "ROCK_PAPER_SCISSORS" &&
        (!Number.isInteger(totalRounds) ||
            totalRounds === undefined ||
            totalRounds < 1 ||
            totalRounds > 10)) {
        throw new AppError(400, "RPS rooms require a number of rounds between 1 and 10.", "INVALID_ROUNDS");
    }
    const existingRoom = getPlayerRoom(playerId);
    if (existingRoom) {
        if (existingRoom.gameStatus === "WAITING") {
            leaveRoom(playerId, socketServer);
        }
    }
    const code = generateRoomCode();
    const createdAt = Date.now();
    const expiresAt = createdAt + WAITING_ROOM_TTL_MS;
    const room = {
        code,
        gameType,
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
        rpsChoices: {},
        totalRounds: gameType === "ROCK_PAPER_SCISSORS" ? totalRounds : null,
        currentRound: 1,
        playerScores: {},
        rpsStats: {},
        roundResult: null,
        rpsRoundHistory: [],
    };
    room.expirationTimer = setTimeout(() => {
        expireRoom(code, socketServer);
    }, WAITING_ROOM_TTL_MS);
    rooms.set(code, room);
    playerToRoom.set(playerId, code);
    console.log(`Room created: ${code} by player: ${playerId} (${playerName})`);
    if (gameType === "ROCK_PAPER_SCISSORS") {
        console.log(`RPS match created: ${code} (${totalRounds} rounds)`);
    }
    return room;
};
export const joinRoom = (code, playerId, playerName, io) => {
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
    const newPlayer = {
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
    }
    else {
        room.gameStatus = "COUNTDOWN";
    }
    return room;
};
const emitRpsCountdown = (room, io, count) => {
    io.to(room.code).emit("game:countdown", {
        count,
        currentRound: room.currentRound,
        totalRounds: room.totalRounds,
    });
};
const startRpsRoundCountdown = (room, io) => {
    clearTurnTimers(room);
    clearCountdownTimer(room);
    clearRpsTransitionTimer(room);
    room.gameStatus = "COUNTDOWN";
    room.rpsChoices = {};
    room.roundResult = null;
    console.log(`RPS round started in room ${room.code}: round ${room.currentRound}/${room.totalRounds}`);
    io.to(room.code).emit("game:round:started", {
        currentRound: room.currentRound,
        totalRounds: room.totalRounds,
    });
    broadcastGameState(room, io);
    let seconds = 3;
    emitRpsCountdown(room, io, seconds);
    const runTick = () => {
        seconds--;
        if (seconds > 0) {
            emitRpsCountdown(room, io, seconds);
            room.countdownTimer = setTimeout(runTick, 1000);
            return;
        }
        room.countdownTimer = undefined;
        room.gameStatus = "PLAYING";
        broadcastGameState(room, io);
    };
    room.countdownTimer = setTimeout(runTick, 1000);
};
export const startCountdown = (room, io) => {
    clearTurnTimers(room);
    clearCountdownTimer(room);
    clearRpsTransitionTimer(room);
    clearRematchTimer(room);
    room.gameStatus = "COUNTDOWN";
    room.board = createEmptyBoard();
    room.winnerPlayerId = null;
    room.winReason = null;
    room.currentTurn = null;
    if (room.gameType === "ROCK_PAPER_SCISSORS") {
        room.currentRound = 1;
        room.playerScores = Object.fromEntries(room.players.map((player) => [player.playerId, 0]));
        room.rpsStats = Object.fromEntries(room.players.map((player) => [
            player.playerId,
            { roundsWon: 0, draws: 0, roundsPlayed: 0 },
        ]));
        room.rpsRoundHistory = [];
        room.roundResult = null;
        startRpsRoundCountdown(room, io);
        return;
    }
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
        }
        else {
            // Countdown finished -> PLAYING
            room.countdownTimer = undefined;
            startGame(room, io);
        }
    };
    room.countdownTimer = setTimeout(runTick, 1000);
};
export const startGame = (room, io) => {
    room.gameStatus = "PLAYING";
    // Player with symbol 'X' goes first
    const playerX = room.players.find((p) => p.symbol === "X");
    room.currentTurn = playerX ? playerX.playerId : room.players[0].playerId;
    console.log(`Game started in room ${room.code}. First turn: player ${room.currentTurn}`);
    broadcastGameState(room, io);
    startTurnTimer(room, io);
};
export const startTurnTimer = (room, io) => {
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
export const handleTurnTimeout = (room, io) => {
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
export const makeMove = (room, playerId, cellIndex, io) => {
    if (room.gameType !== "TIC_TAC_TOE")
        return false;
    // Server-authoritative validation
    if (room.gameStatus !== "PLAYING")
        return false;
    if (room.currentTurn !== playerId)
        return false;
    if (cellIndex < 0 || cellIndex > 8 || !Number.isInteger(cellIndex))
        return false;
    if (room.board[cellIndex] !== null)
        return false;
    const player = room.players.find((p) => p.playerId === playerId);
    if (!player || !player.symbol)
        return false;
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
export const submitRpsChoice = (room, playerId, choice, io) => {
    if (room.gameType !== "ROCK_PAPER_SCISSORS")
        return false;
    if (room.gameStatus !== "PLAYING")
        return false;
    if (!room.players.some((player) => player.playerId === playerId && !player.left))
        return false;
    if (!isRpsChoice(choice) || room.rpsChoices[playerId])
        return false;
    room.rpsChoices[playerId] = choice;
    console.log(`RPS choice submitted in room ${room.code}: player ${playerId}, round ${room.currentRound}`);
    broadcastGameState(room, io);
    if (room.players.length === 2 && room.players.every((player) => room.rpsChoices[player.playerId])) {
        startRpsResultCountdown(room, io);
    }
    return true;
};
const startRpsResultCountdown = (room, io) => {
    clearCountdownTimer(room);
    room.gameStatus = "COUNTDOWN";
    broadcastGameState(room, io);
    let seconds = 3;
    emitRpsCountdown(room, io, seconds);
    const runTick = () => {
        seconds--;
        if (seconds > 0) {
            emitRpsCountdown(room, io, seconds);
            room.countdownTimer = setTimeout(runTick, 1000);
            return;
        }
        room.countdownTimer = undefined;
        finishRpsRound(room, io);
    };
    room.countdownTimer = setTimeout(runTick, 1000);
};
const finishRpsRound = (room, io) => {
    const [first, second] = room.players;
    const firstChoice = room.rpsChoices[first.playerId];
    const secondChoice = room.rpsChoices[second.playerId];
    if (!firstChoice || !secondChoice)
        return;
    const winner = getRpsWinner(first.playerId, firstChoice, second.playerId, secondChoice);
    const isDraw = winner === "DRAW";
    const winnerPlayerId = isDraw ? null : winner;
    room.roundResult = {
        winnerPlayerId,
        isDraw,
        playerChoices: { [first.playerId]: firstChoice, [second.playerId]: secondChoice },
    };
    for (const player of room.players) {
        const stats = room.rpsStats[player.playerId] ?? {
            roundsWon: 0,
            draws: 0,
            roundsPlayed: 0,
        };
        stats.roundsPlayed++;
        if (isDraw)
            stats.draws++;
        if (winnerPlayerId === player.playerId) {
            stats.roundsWon++;
            room.playerScores[player.playerId] = (room.playerScores[player.playerId] ?? 0) + 1;
        }
        room.rpsStats[player.playerId] = stats;
    }
    room.rpsRoundHistory.push({
        round: room.currentRound,
        playerChoices: { ...room.roundResult.playerChoices },
        winnerPlayerId,
        isDraw,
    });
    room.gameStatus = "FINISHED";
    room.winnerPlayerId =
        room.currentRound === room.totalRounds
            ? getRpsMatchWinner(room)
            : null;
    room.winReason = room.currentRound === room.totalRounds
        ? room.winnerPlayerId === "DRAW" ? "DRAW" : "NORMAL"
        : null;
    console.log(`RPS round completed in room ${room.code}: round ${room.currentRound}`);
    console.log(`RPS score updated in room ${room.code}: ${JSON.stringify(room.playerScores)}`);
    broadcastGameState(room, io);
    io.to(room.code).emit("game:round:result", {
        currentRound: room.currentRound,
        totalRounds: room.totalRounds,
        roundResult: room.roundResult,
        scores: room.playerScores,
    });
    if (room.currentRound < room.totalRounds) {
        room.rpsTransitionTimer = setTimeout(() => {
            room.rpsTransitionTimer = undefined;
            room.currentRound++;
            startRpsRoundCountdown(room, io);
        }, RPS_ROUND_TRANSITION_MS);
    }
    else {
        io.to(room.code).emit("game:finished", {
            winner: room.winnerPlayerId,
            winReason: room.winReason,
            room: sanitizeRoom(room),
        });
        console.log(`RPS match completed in room ${room.code}`);
    }
};
const getRpsMatchWinner = (room) => {
    const [first, second] = room.players;
    const firstScore = room.playerScores[first.playerId] ?? 0;
    const secondScore = room.playerScores[second.playerId] ?? 0;
    if (firstScore === secondScore)
        return "DRAW";
    return firstScore > secondScore ? first.playerId : second.playerId;
};
export const requestRematch = (room, playerId, io) => {
    if (room.gameStatus !== "FINISHED")
        return false;
    if (room.gameType === "ROCK_PAPER_SCISSORS" &&
        room.currentRound !== room.totalRounds)
        return false;
    // Cannot request if a player has already left
    if (room.players.some((p) => p.left))
        return false;
    // Prevent duplicate rematch requests
    if (room.rematch)
        return false;
    const requester = room.players.find((p) => p.playerId === playerId);
    if (!requester)
        return false;
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
export const acceptRematch = (room, playerId, io) => {
    if (room.gameStatus !== "REMATCH_PENDING" || !room.rematch)
        return false;
    if (room.rematch.requestedBy === playerId)
        return false; // Must be accepted by the other player
    clearRematchTimer(room);
    io.to(room.code).emit("rematch:accepted", {
        acceptedBy: playerId,
    });
    // Start countdown for new game
    if (room.gameType === "ROCK_PAPER_SCISSORS") {
        console.log(`RPS rematch started in room ${room.code}`);
    }
    startCountdown(room, io);
    return true;
};
export const declineRematch = (room, playerId, io) => {
    if (room.gameStatus !== "REMATCH_PENDING" || !room.rematch)
        return false;
    clearRematchTimer(room);
    io.to(room.code).emit("rematch:declined", {
        declinedBy: playerId,
    });
    // If declined -> delete room
    deleteRoom(room.code, io);
    return true;
};
export const leaveRoom = (playerId, io) => {
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
        clearRpsTransitionTimer(room);
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
        clearRpsTransitionTimer(room);
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
export const handlePlayerDisconnect = (playerId, socketId, io) => {
    const room = getPlayerRoom(playerId);
    if (!room)
        return;
    const player = room.players.find((p) => p.playerId === playerId);
    if (!player || player.socketId !== socketId)
        return;
    player.connected = false;
    player.socketId = undefined;
    io.to(room.code).emit("player:disconnected", {
        playerId,
        name: player.displayName,
    });
    // Start 60-second reconnect grace period if game is in progress, countdown, or rematch pending
    if (room.gameStatus === "PLAYING" ||
        room.gameStatus === "COUNTDOWN" ||
        room.gameStatus === "REMATCH_PENDING") {
        if (player.reconnectTimer) {
            clearTimeout(player.reconnectTimer);
        }
        player.reconnectTimer = setTimeout(() => {
            handleDisconnectTimeout(room.code, playerId, io);
        }, RECONNECT_GRACE_PERIOD_MS);
    }
};
export const handleDisconnectTimeout = (code, playerId, io) => {
    const room = rooms.get(code);
    if (!room)
        return;
    const player = room.players.find((p) => p.playerId === playerId);
    if (!player || player.connected)
        return;
    player.left = true;
    playerToRoom.delete(playerId);
    // Connected player wins by abandonment
    const connectedPlayer = room.players.find((p) => p.connected && !p.left);
    clearTurnTimers(room);
    clearCountdownTimer(room);
    clearRpsTransitionTimer(room);
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
export const handlePlayerReconnect = (room, playerId, socketId, io) => {
    const player = room.players.find((p) => p.playerId === playerId);
    if (!player)
        return;
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
export const expireRoom = (code, io) => {
    const room = rooms.get(code);
    if (!room)
        return;
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
export const deleteRoom = (code, io) => {
    const room = rooms.get(code);
    if (!room)
        return;
    clearAllRoomTimers(room);
    for (const player of room.players) {
        if (playerToRoom.get(player.playerId) === code) {
            playerToRoom.delete(player.playerId);
        }
    }
    rooms.delete(code);
    console.log(`Room deleted: ${code}`);
};
export const deleteAllRooms = () => {
    for (const code of rooms.keys()) {
        deleteRoom(code);
    }
};
export const getClientGameState = (room, viewerPlayerId) => {
    const players = room.players.map((p) => ({
        playerId: p.playerId,
        name: p.displayName,
        symbol: p.symbol,
        isConnected: p.connected,
        isMyTurn: room.gameStatus === "PLAYING" && room.currentTurn === p.playerId,
    }));
    return {
        code: room.code,
        gameType: room.gameType,
        gameStatus: room.gameStatus,
        board: [...room.board],
        players,
        currentTurn: room.currentTurn,
        winner: room.winnerPlayerId || null,
        winnerPlayerId: room.winnerPlayerId || null,
        winReason: room.winReason ?? null,
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
        rps: room.gameType === "ROCK_PAPER_SCISSORS"
            ? {
                totalRounds: room.totalRounds,
                currentRound: room.currentRound,
                myChoice: viewerPlayerId ? room.rpsChoices[viewerPlayerId] ?? null : null,
                opponentChoice: (() => {
                    const opponent = viewerPlayerId
                        ? room.players.find((player) => player.playerId !== viewerPlayerId)
                        : undefined;
                    return room.roundResult && opponent
                        ? room.roundResult.playerChoices[opponent.playerId] ?? null
                        : null;
                })(),
                opponentHasChosen: viewerPlayerId
                    ? room.players.some((player) => player.playerId !== viewerPlayerId &&
                        Boolean(room.rpsChoices[player.playerId]))
                    : false,
                acceptingChoices: room.gameStatus === "PLAYING",
                scores: { ...room.playerScores },
                stats: Object.fromEntries(Object.entries(room.rpsStats).map(([playerId, stats]) => [
                    playerId,
                    { ...stats },
                ])),
                roundResult: room.roundResult
                    ? {
                        ...room.roundResult,
                        playerChoices: { ...room.roundResult.playerChoices },
                    }
                    : null,
                matchWinnerPlayerId: room.currentRound === room.totalRounds ? room.winnerPlayerId ?? null : null,
                roundHistory: room.rpsRoundHistory.map((entry) => ({
                    ...entry,
                    playerChoices: { ...entry.playerChoices },
                })),
            }
            : null,
    };
};
export const broadcastGameState = (room, io) => {
    for (const player of room.players) {
        if (player.socketId) {
            io.to(player.socketId).emit("game:state", getClientGameState(room, player.playerId));
        }
    }
};
export const broadcastRoomState = (room, io) => {
    io.to(room.code).emit("room:updated", {
        room: sanitizeRoom(room),
    });
    broadcastGameState(room, io);
};
export const sanitizeRoom = (room) => {
    const { expirationTimer, turnTimer, turnInterval, turnStartedAt, countdownTimer, rpsChoices, ...safeRoom } = room;
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
        rpsStats: Object.fromEntries(Object.entries(room.rpsStats).map(([playerId, stats]) => [
            playerId,
            {
                displayName: room.players.find((player) => player.playerId === playerId)?.displayName,
                ...stats,
                finalScore: room.playerScores[playerId] ?? 0,
            },
        ])),
        rematch: safeRematch,
    };
};
