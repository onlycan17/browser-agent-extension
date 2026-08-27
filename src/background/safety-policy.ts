import type { ObservedElement } from "../shared/page";
import { isSensitiveAutocomplete } from "../shared/sensitive-input";

export type SafetyDecision =
  | { outcome: "allow" }
  | { outcome: "confirm"; reason: string }
  | { outcome: "deny"; reason: string };

export type ActionProposal =
  | { action: "click"; element: ObservedElement; pageUrl: string }
  | { action: "type_text"; element: ObservedElement }
  | { action: "press_key"; key: string }
  | { action: "scroll" }
  | { action: "scroll_element"; element: ObservedElement }
  | { action: "select_option"; element: ObservedElement }
  | { action: "set_checked"; element: ObservedElement }
  | { action: "youtube_control" };

const SENSITIVE_PATTERN =
  /password|passcode|one.?time|otp|card number|cvv|cvc|비밀번호|인증.?코드|카드.?번호/i;
const CONFIRM_PATTERN =
  /submit|send|purchase|buy|pay|delete|remove|login|sign in|logout|download|전송|제출|구매|결제|삭제|로그인|로그아웃|다운로드/i;
const PROTECTED_TYPES = new Set(["file", "hidden", "password"]);

function externalDestination(element: ObservedElement, pageUrl: string): boolean {
  if (element.href === undefined) return false;
  try {
    return new URL(element.href).origin !== new URL(pageUrl).origin;
  } catch {
    return true;
  }
}

export class SafetyPolicy {
  evaluate(proposal: ActionProposal): SafetyDecision {
    if (
      proposal.action === "scroll" ||
      proposal.action === "scroll_element" ||
      proposal.action === "youtube_control"
    ) {
      return { outcome: "allow" };
    }
    if (proposal.action === "press_key") {
      return proposal.key === "Enter"
        ? { outcome: "confirm", reason: "Enter may submit the active form." }
        : { outcome: "allow" };
    }
    if (SENSITIVE_PATTERN.test(proposal.element.name)) {
      return {
        outcome: "deny",
        reason: "Sensitive credential and payment fields are not supported.",
      };
    }
    if (proposal.action === "select_option" || proposal.action === "set_checked") {
      return {
        outcome: "confirm",
        reason: "Changing a form control can trigger site-defined side effects.",
      };
    }
    if (proposal.action === "type_text") return this.evaluateTextInput(proposal.element);
    return this.evaluateClick(proposal.element, proposal.pageUrl);
  }

  private evaluateTextInput(element: ObservedElement): SafetyDecision {
    if (isSensitiveAutocomplete(element.autocomplete)) {
      return { outcome: "deny", reason: "Sensitive credential fields are not supported." };
    }
    if (element.inputType !== undefined && PROTECTED_TYPES.has(element.inputType)) {
      return { outcome: "deny", reason: "This input type cannot be edited." };
    }
    return { outcome: "allow" };
  }

  private evaluateClick(element: ObservedElement, pageUrl: string): SafetyDecision {
    if (
      element.inputType === "submit" ||
      element.download === true ||
      CONFIRM_PATTERN.test(element.name)
    ) {
      return { outcome: "confirm", reason: "This action may submit data or change an account." };
    }
    if (externalDestination(element, pageUrl)) {
      return { outcome: "confirm", reason: "This action opens a different site." };
    }
    return { outcome: "confirm", reason: "Page clicks can trigger site-defined side effects." };
  }
}
