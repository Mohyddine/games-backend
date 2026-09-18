import { Server as SocketIOServer } from "socket.io";
import { corsOptions } from "./config/cors.js";
import { SESSION_COOKIE_NAME, getSession } from "./session/sessionStore.js";
import { getPlayerRoom, handlePlayerReconnect, handlePlayerDisconnect, makeMove, leaveRoom, requestRematch, acceptRematch, declineRematch, sanitizeRoom, normalizeRoomCode, getRoom, submitRpsChoice, } from "./room/roomStore.js";
// Helper to parse cookies from raw Cookie header string
const parseCookies = (cookieHeader) => {
    const list = {};
    if (!cookieHeader)
        return list;
    cookieHeader.split(";").forEach((cookie) => {
        const parts = cookie.split("=");
        const name = parts.shift()?.trim();
        if (name) {
            const val = parts.join("=").trim();
            list[name] = decodeURIComponent(val);
        }
    });
    return list;
};
export const setupSocketIO = (httpServer) => {
    const io = new SocketIOServer(httpServer, {
        cors: corsOptions,
    });
    // Authentication middleware using HTTP-only session cookie
    io.use((socket, next) => {
        try {
            const cookieHeader = socket.handshake.headers.cookie;
            const cookies = parseCookies(cookieHeader);
            const sessionId = cookies[SESSION_COOKIE_NAME];
            if (!sessionId) {
                return next(new Error("Authentication error: session cookie required"));
            }
            const session = getSession(sessionId);
            if (!session) {
                return next(new Error("Authentication error: invalid or expired session"));
            }
            // Associate socket with player session
            socket.sessionId = sessionId;
            socket.session = session;
            next();
        }
        catch (err) {
            next(new Error("Authentication error"));
        }
    });
    io.on("connection", (socket) => {
        const session = socket.session;
        const playerId = session.playerId;
        console.log(`Socket connected: ${socket.id} (playerId: ${playerId}, name: ${session.name})`);
        // Restore room if player is already in one
        const room = getPlayerRoom(playerId);
        if (room) {
            socket.join(room.code);
            handlePlayerReconnect(room, playerId, socket.id, io);
        }
        // Client -> Server: room:join
        socket.on("room:join", (payload) => {
            try {
                if (!payload?.code)
                    return;
                const normalized = normalizeRoomCode(payload.code);
                const targetRoom = getRoom(normalized);
                if (!targetRoom) {
                    return;
                }
                const playerInRoom = targetRoom.players.find((p) => p.playerId === playerId);
                if (!playerInRoom) {
                    // Player must join via REST POST /api/v1/rooms/:code/join first
                    return;
                }
                socket.join(targetRoom.code);
                handlePlayerReconnect(targetRoom, playerId, socket.id, io);
                socket.emit("room:joined", { room: sanitizeRoom(targetRoom) });
            }
            catch (err) {
                // Invalid room joins or errors
            }
        });
        // Client -> Server: room:leave
        socket.on("room:leave", () => {
            try {
                const currentRoom = getPlayerRoom(playerId);
                if (currentRoom) {
                    socket.leave(currentRoom.code);
                    leaveRoom(playerId, io);
                }
            }
            catch (err) {
                // Ignored
            }
        });
        // Client -> Server: game:move
        socket.on("game:move", (payload) => {
            try {
                const currentRoom = getPlayerRoom(playerId);
                if (!currentRoom)
                    return;
                // Support cell / index / cellIndex payloads
                const selectedCell = payload?.cellIndex ?? payload?.cell ?? payload?.index;
                if (typeof selectedCell !== "number")
                    return;
                // Authoritative move validation: invalid moves are silently ignored
                makeMove(currentRoom, playerId, selectedCell, io);
            }
            catch (err) {
                // Ignored
            }
        });
        socket.on("game:rps:submit", (payload) => {
            try {
                const currentRoom = getPlayerRoom(playerId);
                if (!currentRoom)
                    return;
                submitRpsChoice(currentRoom, playerId, payload?.choice, io);
            }
            catch (err) {
                // Invalid submissions are ignored, matching game:move behavior.
            }
        });
        // Client -> Server: rematch:request
        socket.on("rematch:request", () => {
            try {
                const currentRoom = getPlayerRoom(playerId);
                if (!currentRoom)
                    return;
                requestRematch(currentRoom, playerId, io);
            }
            catch (err) {
                // Ignored
            }
        });
        // Client -> Server: rematch:accept
        socket.on("rematch:accept", () => {
            try {
                const currentRoom = getPlayerRoom(playerId);
                if (!currentRoom)
                    return;
                acceptRematch(currentRoom, playerId, io);
            }
            catch (err) {
                // Ignored
            }
        });
        // Client -> Server: rematch:decline
        socket.on("rematch:decline", () => {
            try {
                const currentRoom = getPlayerRoom(playerId);
                if (!currentRoom)
                    return;
                declineRematch(currentRoom, playerId, io);
            }
            catch (err) {
                // Ignored
            }
        });
        socket.on("disconnect", (reason) => {
            console.log(`Socket disconnected: ${socket.id} (playerId: ${playerId}, reason: ${reason})`);
            handlePlayerDisconnect(playerId, socket.id, io);
        });
    });
    return { io };
};
