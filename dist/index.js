"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const twitch_1 = require("./chat/twitch");
const youtube_1 = require("./chat/youtube");
dotenv_1.default.config();
const PORT = Number(process.env.PORT) || 3001;
const TWITCH_CHANNEL = process.env.TWITCH_CHANNEL;
const HISTORY_SIZE = 50;
const history = [];
const app = (0, express_1.default)();
app.use("/chat", express_1.default.static(path_1.default.join(__dirname, "..", "public")));
const server = app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server on http://localhost:${PORT}`));
const wss = new ws_1.WebSocketServer({ server });
function broadcast(msg) {
    history.push(msg);
    if (history.length > HISTORY_SIZE)
        history.shift();
    const data = JSON.stringify(msg);
    wss.clients.forEach((c) => c.readyState === 1 && c.send(data));
}
wss.on("connection", (socket) => {
    if (history.length) {
        socket.send(JSON.stringify(history));
    }
});
(0, twitch_1.initTwitch)(TWITCH_CHANNEL, broadcast);
(0, youtube_1.autoYouTubeChat)(process.env.YT_CHANNEL_ID, process.env.YT_API_KEY, broadcast);
