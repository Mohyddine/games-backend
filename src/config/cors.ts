import type { CorsOptions } from "cors";
import { config } from "./index.js";

export const PRODUCTION_FRONTEND_ORIGIN = "https://games.codewithmehyo.com";

const isLocalhostOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1"
    );
  } catch {
    return false;
  }
};

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (isLocalhostOrigin(origin)) {
      callback(null, true);
      return;
    }

    if (
      origin === PRODUCTION_FRONTEND_ORIGIN ||
      (config.corsOrigin && origin === config.corsOrigin)
    ) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  optionsSuccessStatus: 204,
};
