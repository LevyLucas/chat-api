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
async function resolveChannelId(input, key) {
    if (input.startsWith("UC"))
        return input.trim();
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
    return id;
}
async function findLiveId(cid, key) {
    const r = await youtube.search.list({
        auth: key,
        part: ["id"],
        channelId: cid,
        eventType: "live",
        type: ["video"],
        maxResults: 1,
    });
    return r.data.items?.[0]?.id?.videoId ?? null;
}
async function fetchChatId(vid, key) {
    const v = await youtube.videos.list({
        auth: key,
        part: ["liveStreamingDetails"],
        id: [vid],
    });
    return v.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
}
async function autoYouTubeChat(rawChannel, apiKey, push) {
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
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const MIN_DELAY = 15000;
    const POLL_MULT = 4;
    let searchInt = 15000;
    const MAX_SEARCH = 30 * 60000;
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
            const delay = Math.max((r.data.pollingIntervalMillis ?? 5000) * POLL_MULT, MIN_DELAY);
            for (const itm of r.data.items ?? []) {
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
            setTimeout(pollChat, delay);
        }
        catch (e) {
            const reason = e?.response?.data?.error?.errors?.[0]?.reason ?? e?.code ?? "desconhecido";
            if (reason === "quotaExceeded") {
                await sleep(15 * 60000);
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
        try {
            const vid = await findLiveId(channelId, apiKey);
            if (vid) {
                const chat = await fetchChatId(vid, apiKey);
                if (chat) {
                    liveChatId = chat;
                    nextPageToken = undefined;
                    searchInt = 15000;
                    pollChat();
                    return;
                }
            }
        }
        catch (e) {
            console.error(e?.response?.data?.error ?? e);
        }
        await sleep(searchInt);
        searchInt = Math.min(searchInt * 2, MAX_SEARCH);
        searchLoop();
    }
    searchLoop();
}
