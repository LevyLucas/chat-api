"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initTwitch = initTwitch;
const tmi_js_1 = __importDefault(require("tmi.js"));
const axios_1 = __importDefault(require("axios"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function twitchEmoteHtml(msg, emotes) {
    if (!emotes)
        return { html: escapeHtml(msg), used: new Set() };
    const occs = [];
    for (const [id, ranges] of Object.entries(emotes)) {
        ranges.forEach((r) => {
            const [s, e] = r.split("-").map(Number);
            occs.push({ start: s, end: e, id });
        });
    }
    occs.sort((a, b) => a.start - b.start);
    let html = "";
    let last = 0;
    const used = new Set();
    const url = (id) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`;
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
function injectExtra(html, raw, extra, skip) {
    return html.replace(/\b(\S+?)\b/g, (m, word) => {
        if (skip.has(word))
            return m;
        const url = extra[word];
        return url ? `<img src="${url}" class="inline w-5 h-5 align-text-bottom" />` : m;
    });
}
async function getAppToken() {
    if (process.env.TWITCH_APP_TOKEN)
        return process.env.TWITCH_APP_TOKEN;
    const { data } = await axios_1.default.post("https://id.twitch.tv/oauth2/token", null, {
        params: {
            client_id: process.env.TWITCH_CLIENT_ID,
            client_secret: process.env.TWITCH_CLIENT_SECRET,
            grant_type: "client_credentials",
        },
    });
    return (process.env.TWITCH_APP_TOKEN = data.access_token);
}
async function getChannelId(login, token) {
    const { data } = await axios_1.default.get("https://api.twitch.tv/helix/users", {
        headers: {
            "Client-ID": process.env.TWITCH_CLIENT_ID,
            Authorization: `Bearer ${token}`,
        },
        params: { login },
    });
    return data.data[0]?.id;
}
async function fetchBadgeMap(channelId, token) {
    const headers = {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
    };
    const [global, channel] = await Promise.all([
        axios_1.default.get("https://api.twitch.tv/helix/chat/badges/global", { headers }),
        axios_1.default.get("https://api.twitch.tv/helix/chat/badges", {
            headers,
            params: { broadcaster_id: channelId },
        }),
    ]);
    const map = {};
    const ingest = (arr) => {
        for (const set of arr.data) {
            const setId = set.set_id;
            const vers = set.versions;
            map[setId] = map[setId] ?? {};
            vers.forEach((v) => (map[setId][v.id] = v));
        }
    };
    ingest(global.data);
    ingest(channel.data);
    return map;
}
async function loadGlobalExtra() {
    try {
        const raw = await promises_1.default.readFile(node_path_1.default.resolve("public/data/twitch-extra-emotes.json"), "utf8");
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
async function loadChannelExtra(channelId) {
    const out = {};
    try {
        const { data } = await axios_1.default.get(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`);
        [...data.channelEmotes, ...data.sharedEmotes].forEach((e) => {
            out[e.code] = `https://cdn.betterttv.net/emote/${e.id}/1x`;
        });
    }
    catch { }
    try {
        const u = await axios_1.default.get(`https://7tv.io/v3/users/twitch/${channelId}`);
        const setId = u.data.emote_set.id;
        const s = await axios_1.default.get(`https://7tv.io/v3/emote-sets/${setId}`);
        s.data.emotes.forEach((e) => {
            out[e.name] = `https://cdn.7tv.app/emote/${e.id}/1x`;
        });
    }
    catch { }
    return out;
}
async function initTwitch(channelLogin, push) {
    const token = await getAppToken();
    const channelId = await getChannelId(channelLogin, token);
    const badgeMap = await fetchBadgeMap(channelId, token);
    const extraGlobal = await loadGlobalExtra();
    const extraChannel = await loadChannelExtra(channelId);
    const extra = { ...extraGlobal, ...extraChannel };
    const client = new tmi_js_1.default.Client({
        channels: [channelLogin],
        connection: { reconnect: true, secure: true },
    });
    client.on("message", (_chan, u, raw, self) => {
        if (self)
            return;
        const badgeUrls = [];
        for (const [set, ver] of Object.entries(u.badges ?? {})) {
            const img = badgeMap[set]?.[ver]?.image_url_1x;
            if (img)
                badgeUrls.push(img);
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
