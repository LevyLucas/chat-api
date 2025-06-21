import { google, youtube_v3 } from "googleapis";
import { ChatMessage } from "../types/ChatMessage";

const youtube = google.youtube("v3");

async function getLiveChatId(channelId: string, apiKey: string): Promise<string | null> {
  try {
    const search = await youtube.search.list({
      auth: apiKey,
      part: ["snippet"],
      channelId,
      eventType: "live",
      type: ["video"],
      maxResults: 1,
    });

    const videoId = (search.data.items?.[0]?.id as youtube_v3.Schema$ResourceId)?.videoId;
    if (!videoId) return null;

    const video = await youtube.videos.list({
      auth: apiKey,
      part: ["liveStreamingDetails"],
      id: [videoId],
    });

    return video.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
  } catch (err) {
    console.error("❌ Erro ao buscar liveChatId:", err);
    return null;
  }
}

function getYouTubeColor(author: youtube_v3.Schema$LiveChatMessageAuthorDetails): string {
  if (author.isChatOwner) return "#FFC700";
  if (author.isChatModerator) return "#00ADEE";
  if (author.isChatSponsor) return "#22C55E";
  return "#FF4D4D";
}

function getYouTubeBadges(author: youtube_v3.Schema$LiveChatMessageAuthorDetails): string[] {
  const badges: string[] = [];
  if (author.isChatOwner) badges.push("👑");
  if (author.isChatModerator) badges.push("🔧");
  if (author.isChatSponsor) badges.push("🌟");
  return badges;
}

export async function autoYouTubeChat(
  channelId: string,
  apiKey: string,
  push: (msg: ChatMessage) => void
) {
  let liveChatId: string | null = null;
  let nextPageToken: string | undefined;
  let lastNoLiveLogged = false;

  async function ensureChatId() {
    liveChatId = await getLiveChatId(channelId, apiKey);

    if (!liveChatId) {
      if (!lastNoLiveLogged) {
        console.log("📡 Nenhuma live ativa — aguardando live começar…");
        lastNoLiveLogged = true;
      }
      setTimeout(ensureChatId, 30_000);
    } else {
      console.log("📺 liveChatId DETECTADO:", liveChatId);
      lastNoLiveLogged = false;
      nextPageToken = undefined;
      poll();
    }
  }

  async function poll() {
    if (!liveChatId) return;

    try {
      const res = await youtube.liveChatMessages.list({
        auth: apiKey,
        part: ["snippet", "authorDetails"],
        liveChatId,
        pageToken: nextPageToken,
      });

      nextPageToken = res.data.nextPageToken ?? undefined;
      const interval = res.data.pollingIntervalMillis ?? 5000;

      res.data.items?.forEach((item) => {
        if (item.snippet?.type !== "textMessageEvent") return;

        const author = item.authorDetails!;
        const user = author.displayName ?? "anon";
        const text = item.snippet.displayMessage ?? "";

        const color = getYouTubeColor(author);
        const badges = getYouTubeBadges(author);

        const message: ChatMessage = {
          platform: "youtube",
          user,
          text,
          color,
          badges,
        };

        push(message);
      });

      setTimeout(poll, interval);
    } catch (err: any) {
      const reason =
        err?.errors?.[0]?.reason ?? err?.code ?? err?.message ?? "desconhecido";
      console.warn("⚠️ Erro ao buscar mensagens do YouTube:", reason);

      if (reason === "quotaExceeded") {
        console.warn("🚫 Cota excedida — pausando polling por 5 minutos...");
        setTimeout(ensureChatId, 5 * 60 * 1000);
      } else {
        console.log("↻ Tentando nova live em 15 segundos…");
        setTimeout(ensureChatId, 15_000);
      }

      liveChatId = null;
    }
  }

  ensureChatId();
}
