import { config } from "../config/index.js";
import { SESSION_TTL_MS } from "./sessionStore.js";
export const getSessionCookieOptions = () => {
    // SameSite=None requires Secure=true (browsers enforce this).
    // In production: Secure=true + SameSite=None (cross-site cookie allowed).
    // In development: Secure=false + SameSite=Lax (works over plain HTTP localhost).
    return {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: config.isProduction ? "none" : "lax",
        path: "/",
        maxAge: SESSION_TTL_MS,
    };
};
