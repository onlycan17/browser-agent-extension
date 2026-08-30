import { describe, expect, it } from "vitest";
import { AGENT_VIDEO_TRANSCRIPT_GUIDANCE } from "../src/shared/video-transcript-guidance";

describe("video transcript guidance prompt", () => {
  it("treats YouTube menu and layout details as observation-based hints", () => {
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain("video description");
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "More (더보기) > Show transcript (스크립트 표시)",
    );
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain("treat this only as a hint");
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).not.toContain(
      "the transcript panel opens on the right side of the video",
    );
  });

  it("re-observes the opened panel before starting a long transcript summary", () => {
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "After a transcript panel opens, re-observe the page",
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

  it("starts playback once to enable inactive transcript controls", () => {
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "Transcript controls often stay inactive until the video has started playing",
    );
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "start playback once with youtube_control (play), re-observe, and retry the transcript controls once",
    );
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain("Never wait for the video to finish");
  });

  it("prefers direct caption reading over panel operations", () => {
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain("call it first for full-video requests");
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain("Udemy, Vimeo");
  });

  it("does not count an enabling playback start against the discovery budget", () => {
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "a playback start used to enable these controls does not count against this budget",
    );
  });

  it("uses observed controls and layout on every video site", () => {
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain(
      "always rely on the current observed controls and layout",
    );
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain("other video sites");
    expect(AGENT_VIDEO_TRANSCRIPT_GUIDANCE).toContain("narrow layouts");
  });
});
