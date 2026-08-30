import { describe, expect, it, vi } from "vitest";
import { readHttpTranscriptChunk, searchVideos } from "../src/content/youtube-http";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function searchFixture(videoId: string, title: string): Record<string, unknown> {
  return {
    contents: [
      {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        videoRenderer: {
                          videoId,
                          title: { runs: [{ text: title }] },
                          ownerText: { runs: [{ text: "Example Channel" }] },
                          thumbnail: {
                            thumbnails: [{ url: "https://i.ytimg.com/small.jpg", width: 168 }],
                          },
                        },
                      },
                      { carouselAdRenderer: {} },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    ],
  };
}

function playerFixture(languageCode: string): Record<string, unknown> {
  return {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            languageCode,
            name: { simpleText: languageCode === "ko" ? "한국어" : "English" },
            kind: languageCode === "ko" ? "asr" : undefined,
            baseUrl: `https://www.youtube.com/api/timedtext?v=aircAruvnKk&lang=${languageCode}`,
          },
        ],
      },
    },
    videoDetails: { title: "Example video" },
  };
}

describe("YouTube HTTP client", () => {
  it("searches videos through the innertube endpoint and parses compact results", async () => {
    const fetch = vi.fn((url: unknown) => {
      expect(String(url)).toContain("youtube.com/youtubei/v1/search");
      expect(String(url)).toContain("prettyPrint=false");
      return Promise.resolve(jsonResponse(searchFixture("abc12345678", "Agent video")));
    });
    vi.stubGlobal("fetch", fetch);

    try {
      const results = await searchVideos("browser agent", 5);

      expect(results).toEqual([
        {
          videoId: "abc12345678",
          url: "https://www.youtube.com/watch?v=abc12345678",
          title: "Agent video",
          channelName: "Example Channel",
        },
      ]);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads transcript chunks directly when the DOM panel is unavailable", async () => {
    const fetch = vi.fn(async (url: unknown) => {
      const target = String(url);
      if (target.includes("/youtubei/v1/player")) {
        return jsonResponse(playerFixture("ko"));
      }
      if (target.includes("timedtext")) {
        return new Response(
          '<transcript><p t="1000" d="2000"><s>First</s> <s>line</s></p><p t="4000" d="1000">Second</p></transcript>',
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetch);
    const fakeLocation = { href: "https://www.youtube.com/watch?v=aircAruvnKk" } as Location;

    try {
      const first = await readHttpTranscriptChunk(fakeLocation, 0, 8_000, "");

      if (!first.available) throw new Error("The HTTP transcript chunk was unavailable.");
      expect(first).toMatchObject({
        cursor: 0,
        nextCursor: 2,
        done: true,
        startTime: "00:01",
        endTime: "00:04",
        segmentCount: 2,
      });
      expect(first.text).toContain("[00:01] First line");
      expect(first.text).toContain("[00:04] Second");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports an actionable reason when no video is open", async () => {
    const fakeLocation = { href: "https://example.com/page" } as Location;

    const chunk = await readHttpTranscriptChunk(fakeLocation, 0, 8_000, "");

    expect(chunk).toMatchObject({
      available: false,
      reason: "No YouTube video is open on this page.",
    });
  });
});
