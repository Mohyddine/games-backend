import { Router } from "express";
import { param, validationResult } from "express-validator";
import { requireSession } from "../middleware/auth.js";
import { createRoom, joinRoom, getPlayerRoom, leaveRoom, sanitizeRoom, normalizeRoomCode, } from "./roomStore.js";
import { createSuccessResponse, AppError } from "../middleware/response.js";
import { isGameType } from "../game/gameTypes.js";
export const roomRouter = Router();
// Middleware to ensure session exists
roomRouter.use(requireSession);
// POST /api/v1/rooms - Create a room
roomRouter.post("/", (req, res, next) => {
    try {
        const session = req.session;
        const io = req.app.get("io");
        if (!isGameType(req.body?.gameType)) {
            throw new AppError(400, "Invalid game type.", "INVALID_GAME_TYPE");
        }
        const room = createRoom(session.playerId, session.name, req.body.gameType, io);
        res.status(201).json(createSuccessResponse({
            code: room.code,
            gameType: room.gameType,
            gameStatus: room.gameStatus,
        }, 201, "Room created successfully."));
    }
    catch (err) {
        next(err);
    }
});
// POST /api/v1/rooms/:code/join - Join a room
roomRouter.post("/:code/join", [
    param("code")
        .trim()
        .isLength({ min: 1, max: 20 })
        .withMessage("Invalid room code."),
], (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(400, "Invalid room code format.", "INVALID_ROOM_CODE");
        }
        const session = req.session;
        const io = req.app.get("io");
        const rawCode = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
        const roomCode = normalizeRoomCode(rawCode);
        const room = joinRoom(roomCode, session.playerId, session.name, io);
        res.status(200).json(createSuccessResponse(sanitizeRoom(room), 200, "Joined room successfully."));
    }
    catch (err) {
        next(err);
    }
});
// GET /api/v1/rooms/current - Get current room state
roomRouter.get("/current", (req, res, next) => {
    try {
        const session = req.session;
        const room = getPlayerRoom(session.playerId);
        if (!room) {
            throw new AppError(404, "You are not currently in a room.", "NOT_IN_ROOM");
        }
        res.status(200).json(createSuccessResponse(sanitizeRoom(room), 200, "Room retrieved successfully."));
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/v1/rooms/current - Leave current room
roomRouter.delete("/current", (req, res, next) => {
    try {
        const session = req.session;
        const io = req.app.get("io");
        const result = leaveRoom(session.playerId, io);
        res.status(200).json(createSuccessResponse({
            left: true,
            roomDeleted: result.roomDeleted,
        }, 200, "Left room successfully."));
    }
    catch (err) {
        next(err);
    }
});
