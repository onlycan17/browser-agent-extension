import { beforeEach, describe, expect, it } from "vitest";
import {
  appendChatMessage,
  setConversationStatus,
  updateChatMessage,
} from "../src/sidepanel/chat-renderer";

function conversation(): HTMLOListElement {
  const element = document.createElement("ol");
  document.body.append(element);
  return element;
}

describe("Side Panel chat renderer", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("separates user and assistant messages in chronological order", () => {
    const log = conversation();
    appendChatMessage(log, { role: "user", body: "화면을 요약해 줘", state: "idle" });
    appendChatMessage(log, {
      role: "assistant",
      title: "요약",
      body: "완료했습니다.",
      state: "complete",
    });

    expect(log.children).toHaveLength(2);
    expect(log.firstElementChild?.classList.contains("chat-message--user")).toBe(true);
    expect(log.lastElementChild?.textContent).toContain("응답 완료");
  });

  it("renders readable Markdown tokens without interpreting model HTML", () => {
    const log = conversation();
    const entry = appendChatMessage(log, {
      role: "assistant",
      title: "분석 결과",
      body: "## 핵심 내용\n- **첫 번째** 항목\n- `두 번째` 항목\n<img src=x onerror=alert(1)>",
      state: "complete",
    });

    expect(entry.querySelector("h4")?.textContent).toBe("핵심 내용");
    expect(entry.querySelectorAll("li")).toHaveLength(2);
    expect(entry.querySelector("strong")?.textContent).toBe("첫 번째");
    expect(entry.querySelector("code")?.textContent).toBe("두 번째");
    expect(entry.querySelector("img")).toBeNull();
    expect(entry.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("updates a thinking response to an explicit completed response", () => {
    const log = conversation();
    const entry = appendChatMessage(log, {
      role: "assistant",
      title: "분석 중",
      body: "잠시만 기다려 주세요.",
      state: "thinking",
    });

    updateChatMessage(entry, {
      role: "assistant",
      title: "분석 결과",
      body: "최종 답변입니다.",
      state: "complete",
    });

    expect(entry.dataset.state).toBe("complete");
    expect(entry.querySelector(".chat-message__status")?.textContent).toBe("응답 완료");
    expect(entry.textContent).toContain("최종 답변입니다.");
    expect(entry.textContent).not.toContain("잠시만 기다려 주세요.");
  });

  it("follows a newly appended message when the user was near the bottom", () => {
    const log = conversation();
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: {
        configurable: true,
        get: () => (log.children.length === 0 ? 300 : 500),
      },
    });
    log.scrollTop = 170;

    appendChatMessage(log, { role: "assistant", body: "새 답변", state: "complete" });

    expect(log.scrollTop).toBe(500);
  });

  it("does not jump to an appended message during manual scrollback", () => {
    const log = conversation();
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: {
        configurable: true,
        get: () => (log.children.length === 0 ? 300 : 500),
      },
    });
    log.scrollTop = 50;

    appendChatMessage(log, { role: "assistant", body: "새 답변", state: "complete" });

    expect(log.scrollTop).toBe(50);
  });

  it("keeps an updated response pinned when the user is near the bottom", () => {
    const log = conversation();
    const entry = appendChatMessage(log, {
      role: "assistant",
      body: "분석 중",
      state: "thinking",
    });
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
    });
    log.scrollTop = 270;

    updateChatMessage(entry, { role: "assistant", body: "긴 최종 답변", state: "complete" });

    expect(log.scrollTop).toBe(400);
  });

  it("preserves manual scrollback when updating a response", () => {
    const log = conversation();
    const entry = appendChatMessage(log, {
      role: "assistant",
      body: "분석 중",
      state: "thinking",
    });
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
    });
    log.scrollTop = 100;

    updateChatMessage(entry, { role: "assistant", body: "긴 최종 답변", state: "complete" });

    expect(log.scrollTop).toBe(100);
  });

  it("announces approval waiting in the conversation header", () => {
    const status = document.createElement("span");
    setConversationStatus(status, "waiting");

    expect(status.dataset.state).toBe("waiting");
    expect(status.textContent).toBe("승인 대기");
  });
});
