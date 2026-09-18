import { AppError, createErrorResponse } from "./response.js";
export const notFoundHandler = (req, res, _next) => {
    res.status(404).json(createErrorResponse(404, `Route ${req.method} ${req.originalUrl} not found.`, "ROUTE_NOT_FOUND"));
};
export const errorHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
        res.status(err.statusCode).json(createErrorResponse(err.statusCode, err.message, err.errorCode));
        return;
    }
    console.error("Unhandled error:", err);
    res.status(500).json(createErrorResponse(500, "Internal server error.", "INTERNAL_SERVER_ERROR"));
};
