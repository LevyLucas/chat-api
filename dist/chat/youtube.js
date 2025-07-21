"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoYouTubeChat = autoYouTubeChat;
const googleapis_1 = require("googleapis");
const youtube = googleapis_1.google.youtube("v3");
function ytColor(a) {
    if (a.isChatOwner)
        return "#FFC700";
    if (a.isChatModerator)
        return "#00ADEE";
    if (a.isChatSponsor)
        return "#22C55E";
    return "#FF4D4D";
}
function ytBadges(a) {
    const b = [];
    if (a.isChatOwner)
        b.push("👑");
    if (a.isChatModerator)
        b.push("🛠️");
    if (a.isChatSponsor)
        b.push("🌟");
    return b;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function ytMessageHtml(item) {
    const parts = item.snippet.messageParts;
    if (!parts)
        return esc(item.snippet?.displayMessage ?? "");
    let html = "";
    for (const p of parts) {
        if (p.type === "text")
            html += esc(p.text ?? "");
        else if (p.type === "emoji" && p.emoji?.imageUrl)
            html += `<img src="${p.emoji.imageUrl}" class="inline w-5 h-5 align-text-bottom" />`;
    }
    return html;
}
const channelCache = new Map();
async function resolveChannelId(input, key) {
    if (input.startsWith("UC"))
        return input.trim();
    if (channelCache.has(input))
        return channelCache.get(input);
    const handle = input.match(/youtube\.com\/(channel\/|user\/|@)?([^/?#]+)/i)?.[2] || input;
    const r = await youtube.search.list({
        auth: key,
        part: ["id"],
        q: handle.replace(/^@/, ""),
        type: ["channel"],
        maxResults: 1,
    });
    const id = r.data.items?.[0]?.id?.channelId;
    if (!id)
        throw new Error("canal não encontrado");
    channelCache.set(input, id);
    return id;
}
async function checkLatestLiveVideo(channelId, key) {
    const chData = await youtube.channels.list({
        auth: key,
        part: ["contentDetails"],
        id: [channelId],
    });
    const uploadPlaylistId = chData.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadPlaylistId)
        return null;
    const items = await youtube.playlistItems.list({
        auth: key,
        part: ["contentDetails"],
        playlistId: uploadPlaylistId,
        maxResults: 1,
    });
    const videoId = items.data.items?.[0]?.contentDetails?.videoId;
    if (!videoId)
        return null;
    const videoInfo = await youtube.videos.list({
        auth: key,
        part: ["snippet", "liveStreamingDetails"],
        id: [videoId],
    });
    const item = videoInfo.data.items?.[0];
    if (item?.snippet?.liveBroadcastContent === "live" &&
        item?.liveStreamingDetails?.activeLiveChatId) {
        return {
            videoId,
            liveChatId: item.liveStreamingDetails.activeLiveChatId,
        };
    }
    return null;
}
async function autoYouTubeChat(rawChannel, rawApiKeys, push) {
    const apiKeys = rawApiKeys.split(",").map((k) => k.trim()).filter(Boolean);
    if (!apiKeys.length)
        throw new Error("Nenhuma API_KEY definida");
    let apiIndex = 0;
    let apiKey = apiKeys[apiIndex];
    const rotateApiKey = () => {
        apiIndex = (apiIndex + 1) % apiKeys.length;
        apiKey = apiKeys[apiIndex];
        console.warn(`[YouTube] Alternando para nova API_KEY: ${apiIndex + 1}/${apiKeys.length}`);
    };
    let channelId;
    try {
        channelId = await resolveChannelId(rawChannel, apiKey);
    }
    catch (e) {
        console.error(e?.message ?? e);
        return;
    }
    let liveChatId = null;
    let nextPageToken;
    let searchRunning = false;
    let lastMessageTimestamp = Date.now();
    let dynamicPollMult = 3;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const MIN_POLL_DELAY = 7000;
    const MAX_SEARCH = 30 * 60000;
    let searchInt = 15000;
    let quotaErrors = 0;
    async function pollChat() {
        if (!liveChatId)
            return;
        try {
            const r = await youtube.liveChatMessages.list({
                auth: apiKey,
                part: ["snippet", "authorDetails"],
                liveChatId,
                pageToken: nextPageToken,
            });
            nextPageToken = r.data.nextPageToken ?? undefined;
            const items = r.data.items ?? [];
            const now = Date.now();
            if (items.length > 0) {
                lastMessageTimestamp = now;
                dynamicPollMult = 3;
            }
            else if (now - lastMessageTimestamp > 60000) {
                dynamicPollMult = 6;
            }
            const delay = Math.max((r.data.pollingIntervalMillis ?? 5000) * dynamicPollMult, MIN_POLL_DELAY);
            for (const itm of items) {
                if (itm.snippet?.type !== "textMessageEvent")
                    continue;
                push({
                    platform: "youtube",
                    user: itm.authorDetails?.displayName ?? "anon",
                    text: ytMessageHtml(itm),
                    color: ytColor(itm.authorDetails),
                    badges: ytBadges(itm.authorDetails),
                });
            }
            quotaErrors = 0;
            setTimeout(pollChat, delay);
        }
        catch (e) {
            const reason = e?.response?.data?.error?.errors?.[0]?.reason ?? e?.code ?? "desconhecido";
            console.warn(`[YouTube] pollChat error: ${reason}`);
            if (reason === "quotaExceeded") {
                quotaErrors++;
                rotateApiKey();
                if (quotaErrors >= 3) {
                    console.warn("[YouTube] Limite de quota excedido repetidamente. Pausando 1h.");
                    await sleep(60 * 60000);
                }
                else {
                    await sleep(15 * 60000);
                }
            }
            else {
                await sleep(30000);
            }
            liveChatId = null;
            nextPageToken = undefined;
            searchLoop();
        }
    }
    async function searchLoop() {
        if (searchRunning)
            return;
        searchRunning = true;
        while (!liveChatId) {
            try {
                const result = await checkLatestLiveVideo(channelId, apiKey);
                if (result) {
                    liveChatId = result.liveChatId;
                    nextPageToken = undefined;
                    searchInt = 15000;
                    quotaErrors = 0;
                    console.log(`[YouTube] ✅ Live detectada. Iniciando leitura de chat.`);
                    pollChat();
                    break;
                }
            }
            catch (e) {
                console.error("[YouTube] searchLoop error:", e?.response?.data?.error ?? e);
            }
            await sleep(searchInt);
            searchInt = Math.min(searchInt * 2, MAX_SEARCH);
        }
        searchRunning = false;
    }
    searchLoop();
}
