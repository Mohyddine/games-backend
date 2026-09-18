import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { corsOptions } from "./config/cors.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import { sessionRouter } from "./session/sessionRouter.js";
import { roomRouter } from "./room/roomRouter.js";
export const createApp = () => {
    const app = express();
    // Core middlewares
    app.use(cors(corsOptions));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser());
    // Health check / root endpoint
    app.get("/", (_req, res) => {
        res.status(200).json({
            status: "ok",
            service: "tic-tac-toe-api",
            version: "1.0.0",
        });
    });
    // REST API v1 routes
    app.use("/api/v1", sessionRouter);
    app.use("/api/v1/rooms", roomRouter);
    // 404 handler for unknown REST routes
    app.use(notFoundHandler);
    // Global error handler
    app.use(errorHandler);
    return app;
};
