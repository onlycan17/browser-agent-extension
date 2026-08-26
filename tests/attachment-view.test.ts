import { describe, expect, it, vi } from "vitest";
import type { RequestAttachment } from "../src/shared/attachments";
import { renderAttachmentList, setAttachmentHelp } from "../src/sidepanel/attachment-view";

const attachment: RequestAttachment = {
  kind: "text",
  name: "README.md",
  mediaType: "text/markdown",
  text: "content",
  size: 5_018,
  truncated: false,
};

describe("attachment view", () => {
  it("renders accessible metadata and delegates removal without mutating input", () => {
    const list = document.createElement("ul");
    list.hidden = true;
    const remove = vi.fn();

    renderAttachmentList(list, [attachment], remove);

    expect(list.hidden).toBe(false);
    expect(list.querySelector(".attachment-chip__name")?.textContent).toBe("README.md");
    expect(list.querySelector(".attachment-chip__metadata")?.textContent).toBe("Markdown · 4.9 KB");
    const button = list.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-label")).toBe("README.md 첨부 제거");
    button?.click();
    expect(remove).toHaveBeenCalledWith(0, attachment);
  });

  it("hides an empty list and persists or clears inline help state", () => {
    const list = document.createElement("ul");
    const help = document.createElement("p");

    renderAttachmentList(list, [], vi.fn());
    setAttachmentHelp(help, "index.ts 파일 형식은 지원하지 않습니다.", "error");

    expect(list.hidden).toBe(true);
    expect(help.textContent).toBe("index.ts 파일 형식은 지원하지 않습니다.");
    expect(help.dataset.state).toBe("error");
    setAttachmentHelp(help, "이미지 · 텍스트 · PDF / 최대 5개");
    expect(help.dataset.state).toBeUndefined();
  });
});
