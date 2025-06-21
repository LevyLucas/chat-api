import { google, youtube_v3 } from "googleapis";
import { ChatMessage } from "../types/ChatMessage";

const youtube = google.youtube("v3");

async function getLiveChatId(
  channelId: string,
  apiKey: string
): Promise<string | null> {
  const search = await youtube.search.list({
    auth: apiKey,
    part: ["snippet"],
    channelId,
    eventType: "live",
    type: ["video"],
    maxResults: 1,
  });

  const videoId = (search.data.items?.[0]?.id as youtube_v3.Schema$ResourceId)
    ?.videoId;
  if (!videoId) return null;

  const video = await youtube.videos.list({
    auth: apiKey,
    part: ["liveStreamingDetails"],
    id: [videoId],
  });

  return (
    video.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null
  );
}

export async function autoYouTubeChat(
  channelId: string,
  apiKey: string,
  push: (msg: ChatMessage) => void
) {
  let liveChatId: string | null = null;
  let nextPageToken: string | undefined;

  async function ensureChatId() {
    liveChatId = await getLiveChatId(channelId, apiKey);
    if (!liveChatId) {
      console.log("↻ Nenhuma live ativa — tentando novamente em 30 s…");
      setTimeout(ensureChatId, 30_000);
    } else {
      console.log("📺 liveChatId DETECTADO:", liveChatId);
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

        push({
          platform: "youtube",
          user: item.authorDetails?.displayName ?? "anon",
          text: item.snippet.displayMessage ?? "",
          color: "#FF0000",
        });
      });

      setTimeout(poll, interval);
    } catch (err: any) {
      console.warn("⚠️ YT polling error:", err?.errors?.[0]?.reason ?? err);
      console.log("↻ Procurando nova live em 15 s…");
      liveChatId = null;
      setTimeout(ensureChatId, 15_000);
    }
  }

  ensureChatId();
}
