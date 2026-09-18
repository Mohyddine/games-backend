import crypto from "node:crypto";
export const SESSION_COOKIE_NAME = "tic_tac_toe_session";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// In-memory session store: sessionId -> Session
const sessions = new Map();
export const createSession = (name) => {
    const sessionId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const chosenName = name && name.trim().length > 0 ? name.trim() : generateRandomPlayerName();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const session = {
        playerId,
        name: chosenName,
        expiresAt,
    };
    sessions.set(sessionId, session);
    return { sessionId, session };
};
export const getSession = (sessionId) => {
    if (!sessionId)
        return null;
    const session = sessions.get(sessionId);
    if (!session)
        return null;
    if (Date.now() > session.expiresAt) {
        sessions.delete(sessionId);
        return null;
    }
    // Refresh expiration on valid activity (sliding expiration)
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session;
};
export const generateRandomPlayerName = (existingNames = []) => {
    const existingSet = new Set(existingNames);
    for (let i = 0; i < 100; i++) {
        const num = Math.floor(Math.random() * 10000);
        const candidate = `Player${num.toString().padStart(4, "0")}`;
        if (!existingSet.has(candidate)) {
            return candidate;
        }
    }
    // Fallback if all attempts collide
    return `Player${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
};
