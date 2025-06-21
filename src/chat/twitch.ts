import tmi from "tmi.js";
import { ChatMessage } from "../types/ChatMessage";

type TwitchUserstate = {
  "display-name"?: string;
  username?: string;
  color?: string;
  badges?: Record<string, string>;
};

export function initTwitch(
  channel: string,
  push: (msg: ChatMessage) => void
) {
  const client = new tmi.Client({
    channels: [channel],
    connection: { reconnect: true, secure: true },
  });

  client.on(
    "message",
    (_chan: string, userstate: TwitchUserstate, message: string, self: boolean) => {
      if (self) return;

      push({
        platform: "twitch",
        user: userstate["display-name"] || userstate.username || "anon",
        text: message,
        color: userstate.color ?? "#9146FF",
        badges: userstate.badges ? Object.keys(userstate.badges) : [],
      });
    }
  );

  client.connect().catch(console.error);
}
