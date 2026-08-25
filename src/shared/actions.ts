export const ALLOWED_KEYS = [
  "Enter",
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
] as const;

export type AllowedKey = (typeof ALLOWED_KEYS)[number];

export type PageActionRequest =
  | { type: "PAGE_CLICK"; payload: { generation: number; elementId: string } }
  | {
      type: "PAGE_TYPE_TEXT";
      payload: { generation: number; elementId: string; text: string; replace: boolean };
    }
  | {
      type: "PAGE_SCROLL";
      payload: { direction: "up" | "down" | "left" | "right"; amount: number };
    }
  | { type: "PAGE_PRESS_KEY"; payload: { key: AllowedKey } }
  | {
      type: "YOUTUBE_CONTROL";
      payload:
        | { action: "play" | "pause" }
        | { action: "seek" | "set_volume" | "set_rate"; value: number };
    };

export interface PageActionResult {
  message: string;
}
