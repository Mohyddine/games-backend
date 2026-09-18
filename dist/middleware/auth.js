import { SESSION_COOKIE_NAME, getSession } from "../session/sessionStore.js";
import { AppError } from "./response.js";
export const requireSession = (req, _res, next) => {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (!sessionId) {
        throw new AppError(401, "Session required. Please create or restore a session.", "UNAUTHORIZED");
    }
    const session = getSession(sessionId);
    if (!session) {
        throw new AppError(401, "Session expired or invalid.", "SESSION_EXPIRED");
    }
    req.sessionId = sessionId;
    req.session = session;
    next();
};
