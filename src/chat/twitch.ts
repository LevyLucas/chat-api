import tmi from "tmi.js";
import axios from "axios";
import dotenv from "dotenv";
import { ChatMessage } from "../types/ChatMessage";
dotenv.config();

type TwitchUserstate = {
  "display-name"?: string;
  username?: string;
  color?: string;
  badges?: Record<string, string>;
};

interface BadgeImages {
  image_url_1x: string;
  image_url_2x: string;
  image_url_4x: string;
}
type BadgeMap = Record<string, Record<string, BadgeImages>>;

interface AppTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}
async function getAppToken(): Promise<string> {
  if (process.env.TWITCH_APP_TOKEN) return process.env.TWITCH_APP_TOKEN;

  const res = await axios.post<AppTokenResponse>(
    "https://id.twitch.tv/oauth2/token",
    null,
    {
      params: {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: "client_credentials",
      },
    }
  );
  const token = res.data.access_token;
  process.env.TWITCH_APP_TOKEN = token;
  return token;
}

interface UsersResponse {
  data: { id: string }[];
}
async function getChannelId(login: string, token: string): Promise<string> {
  const res = await axios.get<UsersResponse>(
    "https://api.twitch.tv/helix/users",
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID!,
        Authorization: `Bearer ${token}`,
      },
      params: { login },
    }
  );
  return res.data.data[0]?.id;
}

async function fetchBadgeMap(channelId: string, token: string): Promise<BadgeMap> {
  const headers = {
    "Client-ID": process.env.TWITCH_CLIENT_ID!,
    Authorization: `Bearer ${token}`,
  };

  const [global, channel] = await Promise.allSettled([
    axios.get("https://badges.twitch.tv/v1/badges/global/display", { headers }),
    axios.get(`https://badges.twitch.tv/v1/badges/channels/${channelId}/display`, { headers }),
  ]);

  const map: BadgeMap = {};

  const ingest = (resp: unknown) => {
    const obj = resp as { badge_sets?: Record<string, { versions: Record<string, BadgeImages> }> };
    if (!obj?.badge_sets) return;
    for (const [set, data] of Object.entries(obj.badge_sets)) {
      map[set] = { ...map[set], ...data.versions };
    }
  };

  if (global.status === "fulfilled") ingest(global.value.data);
  if (channel.status === "fulfilled") ingest(channel.value.data);

  return map;
}

export async function initTwitch(
  channelLogin: string,
  push: (msg: ChatMessage) => void
) {
  const token = await getAppToken();
  const channelId = await getChannelId(channelLogin, token);
  const badgeMap = await fetchBadgeMap(channelId, token);

  const client = new tmi.Client({
    channels: [channelLogin],
    connection: { reconnect: true, secure: true },
  });

  client.on(
    "message",
    (_chan: string, userstate: TwitchUserstate, message: string, self: boolean) => {
      if (self) return;

      const badgeUrls =
        userstate.badges
          ? Object.entries(userstate.badges)
              .map(([set, version]) => badgeMap[set]?.[version]?.image_url_1x)
              .filter(Boolean)
          : [];

      push({
        platform: "twitch",
        user: userstate["display-name"] || userstate.username || "anon",
        text: message,
        color: userstate.color ?? "#9146FF",
        badges: badgeUrls,
      });
    }
  );

  client.connect().catch(console.error);
}
