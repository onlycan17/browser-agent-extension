import type { ChatState } from "./chat-renderer";

export const APPROVE_RUN_LABEL = "이 요청 모두 승인";

export interface ApprovalPresentation {
  body: string;
  state: ChatState;
  title: string;
}

export function approvalPresentation(approved: boolean, accepted: boolean): ApprovalPresentation {
  if (!accepted) {
    return {
      title: "승인 요청이 만료됐어요",
      body: "동작을 실행하지 않았습니다.",
      state: "cancelled",
    };
  }
  if (!approved) {
    return {
      title: "요청한 동작을 거부했어요",
      body: "승인하지 않은 동작은 실행하지 않습니다.",
      state: "cancelled",
    };
  }
  return {
    title: "승인했어요",
    body: "이 요청의 나머지 승인 대상 동작도 추가 확인 없이 실행합니다.",
    state: "thinking",
  };
}
