import { describe, expect, it } from "vitest";
import { AGENT_VIDEO_TRANSCRIPT_GUIDANCE } from "../src/shared/video-transcript-guidance";

describe("video transcript guidance prompt", () => {
  it("states the YouTube desktop control sequence and right-side panel location", () => {
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "More (더보기) > Show transcript (스크립트 표시)",
    );
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "the transcript panel opens on the right side of the video",
    );
  });

  it("re-observes the opened panel before starting a long transcript summary", () => {
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "After the right-side transcript panel opens, re-observe the page",
    );
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "use summarize_video_transcript for a long or full-video analysis",
    );
  });

  it("forbids waiting for playback to collect a full-video transcript", () => {
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "Never play through or wait for the video to finish",
    );
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "summarize_video_transcript before using playback controls",
    );
  });

  it("does not apply the YouTube desktop panel position to other layouts", () => {
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "Apply the right-side location only to YouTube desktop",
    );
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain("other video sites or narrow layouts");
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).not.toContain(
      "the transcript panel always opens on the right",
    );
  });
});
