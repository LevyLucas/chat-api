import { google, youtube_v3 } from "googleapis";
import dotenv from "dotenv";
dotenv.config();

// Crie o client já com auth = sua API key
const youtube = google.youtube({
  version: "v3",
  auth: process.env.YT_API_KEY,
});

async function getLiveChatId() {
  // 1) Busca a live atual do canal
  const searchRes = await youtube.search.list({
    part: ["snippet"],
    channelId: "UCnd5MQmEvD3w8WfZG95xo2g", // canal da Nana
    eventType: "live",
    type: ["video"],          // precisa ser array
    maxResults: 1,
  });

  const videoId = (searchRes.data.items?.[0]?.id as youtube_v3.Schema$ResourceId)
    ?.videoId;

  if (!videoId) {
    console.log("❌ Nenhuma live ativa encontrada.");
    return;
  }

  // 2) Pega os detalhes da live para obter o chatId
  const videoRes = await youtube.videos.list({
    part: ["liveStreamingDetails"],
    id: [videoId],            // array OU string separado por vírgula
  });

  const chatId =
    videoRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;

  if (!chatId) {
    console.log("❌ liveChatId não encontrado.");
  } else {
    console.log("✅ liveChatId:", chatId);
  }
}

getLiveChatId().catch(console.error);
