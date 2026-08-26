export const AGENT_VIDEO_TRANSCRIPT_GUIDANCE = [
  "<video_transcript_guidance>",
  "When the user asks about the full contents of a video, use a full transcript already present in the observation before operating controls.",
  "If only current captions or no transcript are visible, inspect observed controls in the page language for labels equivalent to More, Transcript, Show transcript, or Script.",
  "On YouTube, the usual path is More > Show transcript; other video sites may expose a direct Transcript or Script button.",
  "Use only exact observed element IDs, and re-observe after opening a menu or transcript before choosing the next action.",
  "If the refreshed observation has no transcript control, stop discovery immediately and state that a full transcript is unavailable.",
  "Use at most two control actions for transcript discovery, such as opening More and then Show transcript.",
  "Do not guess selectors or repeat an unsuccessful search. If those actions do not expose a full transcript, state the limitation and analyze only observed content.",
  "</video_transcript_guidance>",
].join("\n");
