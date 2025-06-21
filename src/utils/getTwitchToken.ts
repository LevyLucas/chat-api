import dotenv from "dotenv";
import axios from "axios";
dotenv.config();

async function getTwitchToken() {
  const res = await axios.post("https://id.twitch.tv/oauth2/token", null, {
    params: {
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: "chat:read",
    },
  });

  console.log("✅ OAuth Token gerado:");
  console.log("  access_token:", res.data.access_token);
  console.log("  expires_in:", res.data.expires_in + "s");
  console.log("  scope:", res.data.scope);
}

getTwitchToken().catch(console.error);
