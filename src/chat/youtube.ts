import { google, youtube_v3 } from "googleapis";
import { ChatMessage } from "../types/ChatMessage";

const youtube = google.youtube("v3");

function ytColor(a: youtube_v3.Schema$LiveChatMessageAuthorDetails) {
  if (a.isChatOwner) return "#FFC700";
  if (a.isChatModerator) return "#00ADEE";
  if (a.isChatSponsor) return "#22C55E";
  return "#FF4D4D";
}

function ytBadges(a: youtube_v3.Schema$LiveChatMessageAuthorDetails) {
  const b: string[] = [];
  if (a.isChatOwner) b.push("👑");
  if (a.isChatModerator) b.push("🛠️");
  if (a.isChatSponsor) b.push("🌟");
  return b;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function ytMessageHtml(item: youtube_v3.Schema$LiveChatMessage) {
  const parts: any[] | undefined = (item.snippet as any).messageParts;
  if (!parts) return esc(item.snippet?.displayMessage ?? "");
  let html = "";
  for (const p of parts) {
    if (p.type === "text") html += esc(p.text ?? "");
    else if (p.type === "emoji" && p.emoji?.imageUrl)
      html += `<img src="${p.emoji.imageUrl}" class="inline w-5 h-5 align-text-bottom" />`;
  }
  return html;
}

const channelCache = new Map<string, string>();

async function resolveChannelId(input: string, key: string) {
  if (input.startsWith("UC")) return input.trim();
  if (channelCache.has(input)) return channelCache.get(input)!;

  const handle = input.match(/youtube\.com\/(channel\/|user\/|@)?([^/?#]+)/i)?.[2] || input;
  const r = await youtube.search.list({
    auth: key,
    part: ["id"],
    q: handle.replace(/^@/, ""),
    type: ["channel"],
    maxResults: 1,
  });
  const id = r.data.items?.[0]?.id?.channelId;
  if (!id) throw new Error("canal não encontrado");
  channelCache.set(input, id);
  return id;
}

async function findLiveId(cid: string, key: string) {
  const r = await youtube.search.list({
    auth: key,
    part: ["id"],
    channelId: cid,
    eventType: "live",
    type: ["video"],
    maxResults: 1,
  });
  return (r.data.items?.[0]?.id as youtube_v3.Schema$ResourceId)?.videoId ?? null;
}

async function fetchChatId(vid: string, key: string) {
  const v = await youtube.videos.list({
    auth: key,
    part: ["liveStreamingDetails"],
    id: [vid],
  });
  return v.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
}

export async function autoYouTubeChat(
  rawChannel: string,
  apiKey: string,
  push: (m: ChatMessage) => void
) {
  let channelId: string;
  try {
    channelId = await resolveChannelId(rawChannel, apiKey);
  } catch (e: any) {
    console.error(e?.message ?? e);
    return;
  }

  let liveChatId: string | null = null;
  let nextPageToken: string | undefined;
  let searchRunning = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const POLL_MULT = 3;
  const MIN_POLL_DELAY = 7000;
  const MAX_SEARCH = 30 * 60_000;
  let searchInt = 15_000;

  let quotaErrors = 0;

  async function pollChat() {
    if (!liveChatId) return;
    try {
      const r = await youtube.liveChatMessages.list({
        auth: apiKey,
        part: ["snippet", "authorDetails"],
        liveChatId,
        pageToken: nextPageToken,
      });

      nextPageToken = r.data.nextPageToken ?? undefined;
      const delay = Math.max(
        (r.data.pollingIntervalMillis ?? 5_000) * POLL_MULT,
        MIN_POLL_DELAY
      );

      for (const itm of r.data.items ?? []) {
        if (itm.snippet?.type !== "textMessageEvent") continue;
        push({
          platform: "youtube",
          user: itm.authorDetails?.displayName ?? "anon",
          text: ytMessageHtml(itm),
          color: ytColor(itm.authorDetails!),
          badges: ytBadges(itm.authorDetails!),
        });
      }

      quotaErrors = 0;
      setTimeout(pollChat, delay);
    } catch (e: any) {
      const reason =
        e?.response?.data?.error?.errors?.[0]?.reason ?? e?.code ?? "desconhecido";
      console.warn(`[YouTube] pollChat error: ${reason}`);

      if (reason === "quotaExceeded") {
        quotaErrors++;
        if (quotaErrors >= 3) {
          console.warn("[YouTube] Limite de quota excedido repetidamente. Pausando por 1 hora.");
          await sleep(60 * 60_000);
        } else {
          await sleep(15 * 60_000);
        }
      } else {
        await sleep(30_000);
      }

      liveChatId = null;
      nextPageToken = undefined;
      searchLoop();
    }
  }

  async function searchLoop() {
    if (searchRunning) return;
    searchRunning = true;

    while (!liveChatId) {
      try {
        const vid = await findLiveId(channelId, apiKey);
        if (vid) {
          const chat = await fetchChatId(vid, apiKey);
          if (chat) {
            liveChatId = chat;
            nextPageToken = undefined;
            searchInt = 15_000;
            quotaErrors = 0;
            console.log(`[YouTube] ✅ Live detectada. Iniciando leitura de chat.`);
            pollChat();
            break;
          }
        }
      } catch (e: any) {
        console.error("[YouTube] searchLoop error:", e?.response?.data?.error ?? e);
      }

      await sleep(searchInt);
      searchInt = Math.min(searchInt * 2, MAX_SEARCH);
    }

    searchRunning = false;
  }

  searchLoop();
}
