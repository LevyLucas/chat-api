export interface ChatMessage {
  platform: "twitch" | "youtube";
  user: string;
  text: string;
  color?: string;
  badges?: string[];
}