import type { ChatState } from "./chat-renderer";

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
    body: "승인한 동작을 실행하고 결과를 확인합니다.",
    state: "thinking",
  };
}
