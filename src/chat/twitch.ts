import tmi from "tmi.js";
import axios from "axios";
import dotenv from "dotenv";
import { ChatMessage } from "../types/ChatMessage";
dotenv.config();

interface BadgeVers {
  id: string;
  image_url_1x: string;
  image_url_2x: string;
  image_url_4x: string;
}
type BadgeMap = Record<string, Record<string, BadgeVers>>;

async function getAppToken(): Promise<string> {
  if (process.env.TWITCH_APP_TOKEN) return process.env.TWITCH_APP_TOKEN;
  const { data } = await axios.post<{ access_token: string }>(
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
  return (process.env.TWITCH_APP_TOKEN = data.access_token);
}

async function getChannelId(login: string, token: string) {
  const { data } = await axios.get<{ data: { id: string }[] }>(
    "https://api.twitch.tv/helix/users",
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID!,
        Authorization: `Bearer ${token}`,
      },
      params: { login },
    }
  );
  return data.data[0]?.id;
}

async function fetchBadgeMap(channelId: string, token: string): Promise<BadgeMap> {
  const headers = {
    "Client-ID": process.env.TWITCH_CLIENT_ID!,
    Authorization: `Bearer ${token}`,
  };

  const [global, channel] = await Promise.all([
    axios.get("https://api.twitch.tv/helix/chat/badges/global", { headers }),
    axios.get("https://api.twitch.tv/helix/chat/badges", {
      headers,
      params: { broadcaster_id: channelId },
    }),
  ]);

  const map: BadgeMap = {};
  const ingest = (arr: any) => {
    for (const set of arr.data.data) {
      const setId = set.set_id as string;
      const vers = set.versions as BadgeVers[];
      map[setId] = map[setId] ?? {};
      vers.forEach((v) => (map[setId][v.id] = v));
    }
  };

  ingest(global);
  ingest(channel);
  return map;
}

function escapeHtml(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type EmoteMap = Record<string, string[]>;

function emoteHtml(msg: string, emotes?: EmoteMap): string {
  if (!emotes) return escapeHtml(msg);

  type Occ = { start: number; end: number; id: string };
  const occs: Occ[] = [];

  for (const [id, ranges] of Object.entries(emotes)) {
    ranges.forEach((r: string) => {
      const [s, e] = r.split("-").map(Number);
      occs.push({ start: s, end: e, id });
    });
  }
  occs.sort((a, b) => a.start - b.start);

  let html = "";
  let last = 0;
  const url = (id: string) =>
    `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`;

  for (const o of occs) {
    html += escapeHtml(msg.slice(last, o.start));
    html += `<img src="${url(o.id)}" class="inline w-5 h-5 align-text-bottom" />`;
    last = o.end + 1;
  }
  html += escapeHtml(msg.slice(last));
  return html;
}

type TUser = {
  "display-name"?: string;
  username?: string;
  color?: string;
  badges?: Record<string, string>;
  emotes?: EmoteMap;
};

export async function initTwitch(
  channelLogin: string,
  push: (m: ChatMessage) => void
) {
  const token = await getAppToken();
  const channelId = await getChannelId(channelLogin, token);
  const badgeMap = await fetchBadgeMap(channelId, token);

  const client = new tmi.Client({
    channels: [channelLogin],
    connection: { reconnect: true, secure: true },
  });

  client.on("message", (_chan: string, u: TUser, raw: string, self: boolean) => {
    if (self) return;

    const badgeUrls: string[] = [];
    for (const [set, ver] of Object.entries(u.badges ?? {})) {
      const img = badgeMap[set]?.[ver]?.image_url_1x;
      if (img) badgeUrls.push(img);
    }

    const html = emoteHtml(raw, u.emotes);

    push({
      platform: "twitch",
      user: u["display-name"] || u.username || "anon",
      text: html,
      color: u.color ?? "#9146FF",
      badges: badgeUrls,
    });
  });

  client.connect().catch(console.error);
}
