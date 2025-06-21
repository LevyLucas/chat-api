import tmi from "tmi.js";
import axios from "axios";
import dotenv from "dotenv";
import { ChatMessage } from "../types/ChatMessage";
dotenv.config();

interface BadgeVers { id:string; image_url_1x:string; image_url_2x:string; image_url_4x:string }
type BadgeMap = Record<string, Record<string,BadgeVers>>;

async function getAppToken(): Promise<string>{
  if (process.env.TWITCH_APP_TOKEN) return process.env.TWITCH_APP_TOKEN;
  const { data } = await axios.post<{access_token:string}>(
    "https://id.twitch.tv/oauth2/token",
    null,
    { params:{
        client_id:     process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type:    "client_credentials"
    }});
  return (process.env.TWITCH_APP_TOKEN = data.access_token);
}

async function getChannelId(login:string, token:string){
  const { data } = await axios.get<{data:{id:string}[]}>(
    "https://api.twitch.tv/helix/users",
    { headers:{
        "Client-ID":   process.env.TWITCH_CLIENT_ID!,
        Authorization: `Bearer ${token}`
      },
      params:{ login }
    });
  return data.data[0]?.id;
}

async function fetchBadgeMap(channelId:string, token:string):Promise<BadgeMap>{
  const headers = {
    "Client-ID":   process.env.TWITCH_CLIENT_ID!,
    Authorization: `Bearer ${token}`
  };

  const [global, channel] = await Promise.all([
    axios.get("https://api.twitch.tv/helix/chat/badges/global",{ headers }),
    axios.get("https://api.twitch.tv/helix/chat/badges",{ headers, params:{ broadcaster_id: channelId }})
  ]);

  const map: BadgeMap = {};
  const ingest = (arr: any) => {
    for (const set of arr.data.data){
      const setId = set.set_id as string;
      const vers  = set.versions as BadgeVers[];
      map[setId]  = map[setId] ?? {};
      vers.forEach(v => (map[setId][v.id] = v));
    }
  };

  ingest(global);
  ingest(channel);
  return map;
}

type TUser = {
  "display-name"?:string; username?:string; color?:string;
  badges?: Record<string,string>;
};

export async function initTwitch(channelLogin:string, push:(m:ChatMessage)=>void){
  const token     = await getAppToken();
  const channelId = await getChannelId(channelLogin, token);
  const badgeMap  = await fetchBadgeMap(channelId, token);

  console.log("✔️ badgeMap carregado:", Object.keys(badgeMap).length, "sets");

  const client = new tmi.Client({
    channels:[channelLogin],
    connection:{ reconnect:true, secure:true }
  });

  client.on("message", (_c:string, u:TUser, msg:string, self:boolean) => {
    if (self) return;

    const urls:string[] = [];
    for (const [set,ver] of Object.entries(u.badges ?? {})){
      const img = badgeMap[set]?.[ver]?.image_url_1x;
      img ? urls.push(img)
          : console.warn(`🚫 Badge não encontrado: ${set}-${ver}`);
    }

    push({
      platform:"twitch",
      user: u["display-name"]||u.username||"anon",
      text: msg,
      color: u.color ?? "#9146FF",
      badges: urls
    });
  });

  client.connect().catch(console.error);
}
