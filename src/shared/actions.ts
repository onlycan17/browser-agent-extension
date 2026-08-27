import type { ObservedElement } from "./page";

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
  | {
      type: "PAGE_CLICK";
      payload: { generation: number; elementId: string; expected: ObservedElement };
    }
  | {
      type: "PAGE_TYPE_TEXT";
      payload: {
        generation: number;
        elementId: string;
        text: string;
        replace: boolean;
        expected: ObservedElement;
      };
    }
  | {
      type: "PAGE_SCROLL";
      payload: { direction: "up" | "down" | "left" | "right"; amount: number };
    }
  | {
      type: "PAGE_SELECT_OPTION";
      payload: {
        generation: number;
        elementId: string;
        optionLabel: string;
        expected: ObservedElement;
      };
    }
  | {
      type: "PAGE_SET_CHECKED";
      payload: {
        generation: number;
        elementId: string;
        checked: boolean;
        expected: ObservedElement;
      };
    }
  | {
      type: "PAGE_SCROLL_ELEMENT";
      payload: {
        generation: number;
        elementId: string;
        direction: "up" | "down" | "left" | "right";
        amount: number;
        expected: ObservedElement;
      };
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
  pageSettled?: boolean;
}
