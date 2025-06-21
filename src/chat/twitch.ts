import tmi from "tmi.js";
import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";
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
type EmoteMap = Record<string, string[]>;
type ExtraMap = Record<string, string>;

type TUser = {
  "display-name"?: string;
  username?: string;
  color?: string;
  badges?: Record<string, string>;
  emotes?: EmoteMap;
};

function escapeHtml(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function twitchEmoteHtml(msg: string, emotes?: EmoteMap) {
  if (!emotes) return { html: escapeHtml(msg), used: new Set<string>() };

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
  const used = new Set<string>();
  const url = (id: string) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`;

  for (const o of occs) {
    const token = msg.slice(o.start, o.end + 1);
    used.add(token);
    html += escapeHtml(msg.slice(last, o.start));
    html += `<img src="${url(o.id)}" class="inline w-5 h-5 align-text-bottom" />`;
    last = o.end + 1;
  }
  html += escapeHtml(msg.slice(last));
  return { html, used };
}

function injectExtra(html: string, raw: string, extra: ExtraMap, skip: Set<string>) {
  return html.replace(/\b(\S+?)\b/g, (m, word: string) => {
    if (skip.has(word)) return m;
    const url = extra[word];
    return url ? `<img src="${url}" class="inline w-5 h-5 align-text-bottom" />` : m;
  });
}

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
    axios.get<{ data: any[] }>("https://api.twitch.tv/helix/chat/badges/global", { headers }),
    axios.get<{ data: any[] }>("https://api.twitch.tv/helix/chat/badges", {
      headers,
      params: { broadcaster_id: channelId },
    }),
  ]);

  const map: BadgeMap = {};
  const ingest = (arr: { data: any[] }) => {
    for (const set of arr.data) {
      const setId = set.set_id as string;
      const vers = set.versions as BadgeVers[];
      map[setId] = map[setId] ?? {};
      vers.forEach((v) => (map[setId][v.id] = v));
    }
  };

  ingest(global.data);
  ingest(channel.data);
  return map;
}

async function loadGlobalExtra(): Promise<ExtraMap> {
  try {
    const raw = await fs.readFile(path.resolve("public/data/twitch-extra-emotes.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function loadChannelExtra(channelId: string): Promise<ExtraMap> {
  const out: ExtraMap = {};

  try {
    const { data } = await axios.get<{
      channelEmotes: { id: string; code: string }[];
      sharedEmotes: { id: string; code: string }[];
    }>(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`);

    [...data.channelEmotes, ...data.sharedEmotes].forEach((e) => {
      out[e.code] = `https://cdn.betterttv.net/emote/${e.id}/1x`;
    });
  } catch {}

  try {
    const u = await axios.get<{ emote_set: { id: string } }>(
      `https://7tv.io/v3/users/twitch/${channelId}`
    );
    const setId = u.data.emote_set.id;

    const s = await axios.get<{ emotes: { id: string; name: string }[] }>(
      `https://7tv.io/v3/emote-sets/${setId}`
    );
    s.data.emotes.forEach((e) => {
      out[e.name] = `https://cdn.7tv.app/emote/${e.id}/1x`;
    });
  } catch {}

  return out;
}

export async function initTwitch(channelLogin: string, push: (m: ChatMessage) => void) {
  const token = await getAppToken();
  const channelId = await getChannelId(channelLogin, token);
  const badgeMap = await fetchBadgeMap(channelId, token);
  const extraGlobal = await loadGlobalExtra();
  const extraChannel = await loadChannelExtra(channelId);
  const extra = { ...extraGlobal, ...extraChannel };

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

    const { html: base, used } = twitchEmoteHtml(raw, u.emotes);
    const html = injectExtra(base, raw, extra, used);

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
