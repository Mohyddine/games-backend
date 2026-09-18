import dotenv from "dotenv";

dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  frontendUrl: string;
  isProduction: boolean;
}

const parsePort = (value: string | undefined, defaultPort = 8080): number => {
  if (!value) return defaultPort;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultPort : parsed;
};

const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "";

export const config: AppConfig = {
  port: parsePort(process.env.PORT, 8080),
  nodeEnv: process.env.NODE_ENV || "development",
  corsOrigin: frontendUrl,
  frontendUrl,
  isProduction: process.env.NODE_ENV === "production",
};
