import { describe, expect, it, vi } from "vitest";
import { parseVtt, readVttTranscriptChunk } from "../src/content/vtt-transcript";

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

const SAMPLE_VTT = [
  "WEBVTT",
  "",
  "1",
  "00:00:01.000 --> 00:00:03.500",
  "<c>Welcome</c> to the <b>course</b>",
  "",
  "2",
  "00:00:04.000 --> 00:00:06.000",
  "Second cue",
  "with two lines",
  "",
  "NOTE",
  "This is a comment block",
  "",
  "00:01:05.500 --> 00:01:07.000",
  "Later cue",
  "",
].join("\n");

describe("VTT transcript fallback", () => {
  it("parses WEBVTT cues with markup, multiline payloads, and NOTE blocks", () => {
    expect(parseVtt(SAMPLE_VTT)).toEqual([
      { offsetSeconds: 1, durationSeconds: 2.5, text: "Welcome to the course" },
      { offsetSeconds: 4, durationSeconds: 2, text: "Second cue with two lines" },
      { offsetSeconds: 65.5, durationSeconds: 1.5, text: "Later cue" },
    ]);
  });

  it("returns no cues for non-VTT content", () => {
    expect(parseVtt("<html><body>not a vtt</body></html>")).toEqual([]);
  });

  it("discovers track element sources and resource entries, then chunks the transcript", async () => {
    const document = {
      querySelectorAll: (selector: string) => {
        if (selector.startsWith("track")) {
          return [
            {
              getAttribute: (name: string) =>
                name === "src" ? "/captions/lecture.vtt?token=1" : null,
            },
          ] as unknown as NodeListOf<Element>;
        }
        return [] as unknown as NodeListOf<Element>;
      },
    } as unknown as Document;
    const fakeLocation = {
      href: "https://academy.example.com/lesson/1",
    } as Location;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown) => {
        expect(String(url)).toBe("https://academy.example.com/captions/lecture.vtt?token=1");
        return Promise.resolve(jsonResponse(SAMPLE_VTT));
      }),
    );
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);

    try {
      const chunk = await readVttTranscriptChunk(document, fakeLocation, 0, 8_000, "");

      if (!chunk.available) throw new Error("The VTT chunk was unavailable.");
      expect(chunk).toMatchObject({
        cursor: 0,
        nextCursor: 3,
        done: true,
        startTime: "00:01",
        endTime: "01:05",
      });
      expect(chunk.text).toContain("[00:01] Welcome to the course");
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("prefers the lecture asset captions API on Udemy pages", async () => {
    const document = { querySelectorAll: () => [] as Element[] } as unknown as Document;
    const fakeLocation = {
      href: "https://www.udemy.com/course/x/learn/lecture/49770897/",
      hostname: "www.udemy.com",
    } as unknown as Location;
    const apiUrl =
      "https://www.udemy.com/api-2.0/users/me/subscribed-courses/6566789/lectures/49770897/?fields[lecture]=asset&fields[asset]=captions";
    const fetch = vi.fn((url: unknown) => {
      expect(String(url)).toBe(apiUrl);
      return Promise.resolve(
        jsonResponse(
          JSON.stringify({
            asset: {
              captions: [
                { url: "https://vtt-c.udemycdn.com/th.vtt", locale_id: "th_TH" },
                { url: "https://vtt-c.udemycdn.com/en.vtt", locale_id: "en_US" },
              ],
            },
          }),
        ),
      );
    });
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: apiUrl },
    ] as PerformanceResourceTiming[]);

    try {
      const chunk = await readVttTranscriptChunk(document, fakeLocation, 0, 8_000, "");

      expect(fetch).toHaveBeenCalledTimes(2);
      const vttUrl = String(fetch.mock.calls[1]?.[0]);
      expect(vttUrl).toBe("https://vtt-c.udemycdn.com/en.vtt");
      expect(chunk.available).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
