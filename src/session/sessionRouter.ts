import { Router, Request, Response, NextFunction } from "express";
import { body, validationResult } from "express-validator";
import {
  SESSION_COOKIE_NAME,
  createSession,
  getSession,
} from "./sessionStore.js";
import { getSessionCookieOptions } from "./sessionCookie.js";
import { createSuccessResponse, AppError } from "../middleware/response.js";

export const sessionRouter = Router();

// Validation chain for a new session name. Existing sessions may be restored
// without resubmitting their name.
const validateSessionBody = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2, max: 20 })
    .withMessage("Name must be between 2 and 20 characters.")
    .matches(/^[a-zA-Z0-9 ]+$/)
    .withMessage("Name must contain letters, numbers, and spaces only."),
];

sessionRouter.post(
  "/session",
  validateSessionBody,
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const firstError = errors.array()[0];
        throw new AppError(400, firstError.msg, "INVALID_NAME");
      }

      const existingCookie = req.cookies?.[SESSION_COOKIE_NAME];
      if (existingCookie) {
        const existingSession = getSession(existingCookie);
        if (existingSession) {
          // Valid session already exists -> restore it without creating a new one
          console.log(`Session restored for player: ${existingSession.playerId} (${existingSession.name})`);
          res.cookie(SESSION_COOKIE_NAME, existingCookie, getSessionCookieOptions());
          res.status(200).json(
            createSuccessResponse({
              playerId: existingSession.playerId,
              name: existingSession.name,
            }, 200, "Session restored.")
          );
          return;
        }
      }

      if (typeof req.body?.name !== "string" || req.body.name.trim().length === 0) {
        throw new AppError(400, "Name is required.", "INVALID_NAME");
      }

      // Create new session
      const name = req.body.name.trim();
      const { sessionId, session } = createSession(name);

      console.log(`Session created for player: ${session.playerId} (${session.name})`);
      res.cookie(SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions());
      res.status(201).json(
        createSuccessResponse({
          playerId: session.playerId,
          name: session.name,
        }, 201, "Session created.")
      );
    } catch (err) {
      next(err);
    }
  }
);
