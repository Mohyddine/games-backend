import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE_NAME, getSession, Session } from "../session/sessionStore.js";
import { AppError } from "./response.js";

// Augment Express Request
declare global {
  namespace Express {
    interface Request {
      sessionId?: string;
      session?: Session;
    }
  }
}

export const requireSession = (req: Request, _res: Response, next: NextFunction): void => {
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
