import { describe, expect, it } from "vitest";
import { APPROVE_RUN_LABEL, approvalPresentation } from "../src/sidepanel/approval-presentation";

describe("Side Panel approval presentation", () => {
  it("labels approval as applying to the full request", () => {
    expect(APPROVE_RUN_LABEL).toBe("이 요청 모두 승인");
  });

  it("continues thinking only after an accepted approval", () => {
    expect(approvalPresentation(true, true)).toEqual({
      title: "승인했어요",
      body: "이 요청의 나머지 승인 대상 동작도 추가 확인 없이 실행합니다.",
      state: "thinking",
    });
  });

  it("shows a denied action as not executed", () => {
    expect(approvalPresentation(false, true)).toEqual({
      title: "요청한 동작을 거부했어요",
      body: "승인하지 않은 동작은 실행하지 않습니다.",
      state: "cancelled",
    });
  });

  it("does not claim continued progress for an expired approval", () => {
    expect(approvalPresentation(true, false)).toEqual({
      title: "승인 요청이 만료됐어요",
      body: "동작을 실행하지 않았습니다.",
      state: "cancelled",
    });
  });
});
