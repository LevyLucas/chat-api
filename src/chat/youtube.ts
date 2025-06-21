import { google, youtube_v3 } from "googleapis";
import { ChatMessage } from "../types/ChatMessage";

const youtube = google.youtube("v3");

function ytColor(a: youtube_v3.Schema$LiveChatMessageAuthorDetails) {
  if (a.isChatOwner)     return "#FFC700";
  if (a.isChatModerator) return "#00ADEE";
  if (a.isChatSponsor)   return "#22C55E";
  return "#FF4D4D";
}
function ytBadges(a: youtube_v3.Schema$LiveChatMessageAuthorDetails) {
  const b: string[] = [];
  if (a.isChatOwner)     b.push("👑");
  if (a.isChatModerator) b.push("🔧");
  if (a.isChatSponsor)   b.push("🌟");
  return b;
}

async function findLiveId(
  channelId: string,
  apiKey: string
): Promise<string | null> {
  const res = await youtube.search.list({
    auth: apiKey,
    part: ["id"],
    channelId,
    eventType: "live",
    type: ["video"],
    maxResults: 1,
  });
  return (res.data.items?.[0]?.id as youtube_v3.Schema$ResourceId)?.videoId ?? null;
}

async function fetchChatId(
  videoId: string,
  apiKey: string
): Promise<string | null> {
  const res = await youtube.videos.list({
    auth: apiKey,
    part: ["liveStreamingDetails"],
    id: [videoId],
  });
  return res.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
}

export async function autoYouTubeChat(
  channelId: string,
  apiKey: string,
  push: (m: ChatMessage) => void
) {
  let liveChatId: string | null = null;
  let nextPageToken: string | undefined;

  let searchInterval = 60_000;
  const maxSearch    = 5 * 60_000;

  async function wait(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function pollChat() {
    if (!liveChatId) return;
    try {
      const res = await youtube.liveChatMessages.list({
        auth: apiKey,
        part: ["snippet", "authorDetails"],
        liveChatId,
        pageToken: nextPageToken,
      });

      const delay = res.data.pollingIntervalMillis ?? 5000;
      nextPageToken = res.data.nextPageToken ?? undefined;

      res.data.items?.forEach(item => {
        if (item.snippet?.type !== "textMessageEvent") return;
        const a = item.authorDetails!;
        push({
          platform: "youtube",
          user:  a.displayName ?? "anon",
          text:  item.snippet.displayMessage ?? "",
          color: ytColor(a),
          badges: ytBadges(a)
        });
      });

      setTimeout(pollChat, delay);
    } catch (e:any) {
      const reason = e?.errors?.[0]?.reason ?? e?.code ?? e?.message;
      console.warn("YT chat error:", reason);
      await backoff(reason);
    }
  }

  async function backoff(reason: string) {
    liveChatId = null;
    nextPageToken = undefined;
    if (reason === "quotaExceeded") {
      console.warn("Quota excedida – aguardando 5 min…");
      await wait(300_000);
    } else if (reason === "liveChatEnded" || reason === "videoNotLive") {
      console.log("Live terminou – voltando a procurar live.");
    } else {
      await wait(30_000);
    }
    searchLoop();
  }

  async function searchLoop() {
    try {
      const videoId = await findLiveId(channelId, apiKey);
      if (videoId) {
        const chatId = await fetchChatId(videoId, apiKey);
        if (chatId) {
          console.log("📺 liveChatId detectado:", chatId);
          liveChatId = chatId;
          nextPageToken = undefined;
          searchInterval = 60_000;
          pollChat();
          return;
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error("Erro busca live:", e.message);
      } else {
        console.error("Erro busca live:", e);
      }
    }

    searchInterval = Math.min(searchInterval * 2, maxSearch);
    setTimeout(searchLoop, searchInterval);
  }

  searchLoop();
}
