import crypto from "node:crypto";
export const SESSION_COOKIE_NAME = "game-session";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// In-memory session store: sessionId -> Session
const sessions = new Map();
export const createSession = (name) => {
    const sessionId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const session = {
        playerId,
        name: name.trim(),
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
