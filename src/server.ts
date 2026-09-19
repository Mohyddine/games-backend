import http from "node:http";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { setupSocketIO } from "./server.socket.js";
import { deleteAllRooms } from "./room/roomStore.js";

const app = createApp();
const server = http.createServer(app);

// Setup Socket.IO
const { io } = setupSocketIO(server);
app.set("io", io);

// Cloud Run binds to 0.0.0.0 and uses process.env.PORT
const PORT = config.port;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT} in ${config.nodeEnv} mode`);
});

const gracefulShutdown = (signal: string) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  deleteAllRooms();
  io.close(() => {
    server.close(() => {
      console.log("HTTP & WebSocket servers closed.");
      process.exit(0);
    });
  });
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export { app, server, io };
