import type { PageActionResult } from "../shared/actions";
import type { YouTubeState } from "../shared/page";

export type YouTubeControl =
  { action: "play" | "pause" } | { action: "seek" | "set_volume" | "set_rate"; value: number };

export class YouTubeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeError";
  }
}

function videoElement(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("video.html5-main-video, video");
}

function captionText(): string | undefined {
  const text = Array.from(document.querySelectorAll<HTMLElement>(".ytp-caption-segment"))
    .map((segment) => segment.textContent)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
  return text.length === 0 ? undefined : text;
}

function videoTitle(): string {
  const heading = document.querySelector<HTMLElement>("h1 yt-formatted-string, h1.title");
  return (heading?.textContent ?? document.title).replace(/\s+-\s+YouTube$/, "").trim();
}

function requireVideo(): HTMLVideoElement {
  const video = videoElement();
  if (video === null) throw new YouTubeError("No YouTube video is available on this page.");
  return video;
}

function requireRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new YouTubeError(`${label} is outside the allowed range.`);
  }
}

function isYouTubeHost(hostname: string): boolean {
  return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
}

export class YouTubeAdapter {
  getState(): YouTubeState | undefined {
    if (!isYouTubeHost(location.hostname)) return undefined;
    const video = videoElement();
    if (video === null) return undefined;
    const caption = captionText();
    return {
      title: videoTitle(),
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      paused: video.paused,
      playbackRate: video.playbackRate,
      volume: video.volume,
      ...(caption === undefined ? {} : { captionText: caption }),
    };
  }

  async control(command: YouTubeControl): Promise<PageActionResult> {
    const video = requireVideo();
    if (command.action === "play") await video.play();
    if (command.action === "pause") video.pause();
    if (command.action === "seek") {
      requireRange(
        command.value,
        0,
        Number.isFinite(video.duration) ? video.duration : 0,
        "Seek time",
      );
      video.currentTime = command.value;
    }
    if (command.action === "set_volume") {
      requireRange(command.value, 0, 1, "Volume");
      video.volume = command.value;
    }
    if (command.action === "set_rate") {
      requireRange(command.value, 0.25, 2, "Playback rate");
      video.playbackRate = command.value;
    }
    return { message: `YouTube ${command.action} completed.` };
  }
}
