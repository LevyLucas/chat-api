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

const esc = (s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function ytMessageHtml(item: youtube_v3.Schema$LiveChatMessage){
  const parts:any[]|undefined = (item.snippet as any).messageParts;
  if(!parts) return esc(item.snippet?.displayMessage ?? "");
  let html="";
  for(const p of parts){
    if(p.type==="text") html+=esc(p.text ?? "");
    else if(p.type==="emoji" && p.emoji?.imageUrl)
      html+=`<img src="${p.emoji.imageUrl}" class="inline w-5 h-5 align-text-bottom" />`;
  }
  return html;
}

async function resolveChannelId(input:string,apiKey:string):Promise<string>{
  if (input.startsWith("UC")) return input.trim();

  const urlMatch = input.match(/youtube\.com\/(channel\/|user\/|@)([^/?#]+)/i);
  if (urlMatch) input = (urlMatch[1] === "@" ? "@":"") + urlMatch[2];

  if (input.startsWith("@")){
    const q = input.slice(1);
    const res = await youtube.search.list({
      auth:apiKey, part:["id"], q, type:["channel"], maxResults:1
    });
    const cid = res.data.items?.[0]?.id?.channelId;
    if(cid) return cid;
    throw new Error("Handle não encontrado: "+input);
  }

  const res = await youtube.channels.list({
    auth:apiKey, part:["id"], forUsername:input, maxResults:1
  });
  const cid = res.data.items?.[0]?.id;
  if(!cid) throw new Error("Canal não encontrado: "+input);
  return cid;
}

async function findLiveId(channelId:string,apiKey:string){
  const res = await youtube.search.list({
    auth: apiKey,
    part: ["id"],
    channelId,
    eventType:"live",
    type:["video"],
    maxResults:1
  });
  return (res.data.items?.[0]?.id as youtube_v3.Schema$ResourceId)?.videoId ?? null;
}
async function fetchChatId(videoId:string,apiKey:string){
  const res = await youtube.videos.list({
    auth: apiKey,
    part: ["liveStreamingDetails"],
    id: [videoId]
  });
  return res.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
}

export async function autoYouTubeChat(
  rawChannel:string,
  apiKey:string,
  push:(m:ChatMessage)=>void
){
  let channelId:string;
  try{
    channelId = await resolveChannelId(rawChannel,apiKey);
    console.log("➡️  channelId resolvido:",channelId);
  }catch(e:any){
    console.error(e?.message ?? e);
    return;
  }

  let liveChatId:string|null=null;
  let nextPageToken:string|undefined;

  let searchInt = 60_000;
  const maxSearch = 5*60_000;

  const wait = (ms:number)=>new Promise(r=>setTimeout(r,ms));

  async function pollChat(){
    if(!liveChatId) return;
    try{
      const res = await youtube.liveChatMessages.list({
        auth:apiKey,
        part:["snippet","authorDetails"],
        liveChatId,
        pageToken:nextPageToken
      });

      nextPageToken = res.data.nextPageToken ?? undefined;
      const delay = res.data.pollingIntervalMillis ?? 5000;

      res.data.items?.forEach(item=>{
        if(item.snippet?.type!=="textMessageEvent") return;
        push({
          platform:"youtube",
          user:  item.authorDetails?.displayName ?? "anon",
          text:  ytMessageHtml(item),
          color: ytColor(item.authorDetails!),
          badges: ytBadges(item.authorDetails!)
        });
      });

      setTimeout(pollChat,delay);
    }catch(e:any){
      const reason =
        e?.response?.data?.error?.errors?.[0]?.reason ??
        e?.code ?? e?.message ?? "desconhecido";
      console.warn("YT chat error:", reason);
      await backoff(reason);
    }
  }

  async function backoff(reason:string){
    liveChatId=null; nextPageToken=undefined;
    if(reason==="quotaExceeded"){
      console.warn("Quota excedida – aguardando 5 min…");
      await wait(300_000);
    }else await wait(30_000);
    searchLoop();
  }

  async function searchLoop(){
    try{
      const vid = await findLiveId(channelId,apiKey);
      if(vid){
        const chat = await fetchChatId(vid,apiKey);
        if(chat){
          console.log("📺 liveChatId detectado:",chat);
          liveChatId=chat; nextPageToken=undefined; searchInt=60_000;
          pollChat(); return;
        }
      }else{
        console.log("… nenhum vídeo ao vivo no momento.");
      }
    }catch(err:any){
      console.error("Erro busca live:", err?.response?.data?.error ?? err);
    }
    searchInt=Math.min(searchInt*2,maxSearch);
    setTimeout(searchLoop,searchInt);
  }

  searchLoop();
}
