import { beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubeAdapter, YouTubeError } from "../src/content/youtube-adapter";

function setYouTubeLocation(): void {
  window.history.replaceState({}, "", "https://www.youtube.com/watch?v=test");
}

function addVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "duration", { configurable: true, value: 120 });
  document.body.append(video);
  return video;
}

describe("YouTubeAdapter", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    setYouTubeLocation();
  });

  it("reads player state and current captions", () => {
    const video = addVideo();
    video.currentTime = 15;
    video.playbackRate = 1.25;
    video.volume = 0.5;
    const caption = document.createElement("span");
    caption.className = "ytp-caption-segment";
    caption.textContent = "Current caption";
    document.body.append(caption);

    expect(new YouTubeAdapter().getState()).toMatchObject({
      currentTime: 15,
      duration: 120,
      playbackRate: 1.25,
      volume: 0.5,
      captionText: "Current caption",
    });
  });

  it("controls pause, seek, volume, and playback rate", async () => {
    const video = addVideo();
    const pause = vi.fn();
    video.pause = pause;
    const adapter = new YouTubeAdapter();

    await adapter.control({ action: "pause" });
    await adapter.control({ action: "seek", value: 30 });
    await adapter.control({ action: "set_volume", value: 0.4 });
    await adapter.control({ action: "set_rate", value: 1.5 });

    expect(pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(30);
    expect(video.volume).toBe(0.4);
    expect(video.playbackRate).toBe(1.5);
  });

  it("rejects values outside safe ranges", async () => {
    addVideo();
    const adapter = new YouTubeAdapter();

    await expect(adapter.control({ action: "set_volume", value: 2 })).rejects.toEqual(
      new YouTubeError("Volume is outside the allowed range."),
    );
  });
});
