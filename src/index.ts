import express from "express";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import path from "path";

import { initTwitch } from "./chat/twitch";
import { autoYouTubeChat } from "./chat/youtube";
import { ChatMessage } from "./types/ChatMessage";

dotenv.config();

const PORT = Number(process.env.PORT) || 3001;
const TWITCH_CHANNEL = process.env.TWITCH_CHANNEL!;
const HISTORY_SIZE = 50;
const history: ChatMessage[] = [];

const app = express();
app.use("/chat", express.static(path.join(__dirname, "..", "public")));

const server = app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server on http://localhost:${PORT}`)
);

const wss = new WebSocketServer({ server });

function broadcast(msg: ChatMessage) {
  history.push(msg);
  if (history.length > HISTORY_SIZE) history.shift();

  const data = JSON.stringify(msg);
  wss.clients.forEach((c) => c.readyState === 1 && c.send(data));
}

wss.on("connection", (socket) => {
  if (history.length) {
    socket.send(JSON.stringify(history));
  }
});

initTwitch(TWITCH_CHANNEL, broadcast);
autoYouTubeChat(process.env.YT_CHANNEL_ID!, process.env.YT_API_KEY!, broadcast);
