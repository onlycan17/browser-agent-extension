import { describe, expect, it } from "vitest";
import { parseContentRequest } from "../src/shared/content-messages";

const expected = {
  id: "e-1-1",
  tag: "button",
  role: "button",
  name: "Submit",
  disabled: false,
  bounds: { x: 10, y: 10, width: 100, height: 30 },
};

describe("content message parser", () => {
  it("accepts an action guarded by the observed element state", () => {
    expect(
      parseContentRequest({
        id: "request-1",
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1-1", expected },
      }),
    ).toEqual({
      id: "request-1",
      type: "PAGE_CLICK",
      payload: { generation: 1, elementId: "e-1-1", expected },
    });
  });

  it("rejects an unguarded element action", () => {
    expect(
      parseContentRequest({
        id: "request-1",
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1-1" },
      }),
    ).toBeNull();
  });

  it("accepts guarded text input metadata without a field value", () => {
    const input = {
      ...expected,
      tag: "input",
      role: "textbox",
      name: "Code",
      inputType: "text",
      autocomplete: "one-time-code",
    };

    expect(
      parseContentRequest({
        id: "request-2",
        type: "PAGE_TYPE_TEXT",
        payload: {
          generation: 1,
          elementId: "e-1-1",
          text: "123456",
          replace: true,
          expected: input,
        },
      }),
    ).toMatchObject({
      type: "PAGE_TYPE_TEXT",
      payload: { expected: { autocomplete: "one-time-code" } },
    });
  });

  it("rejects a guard for a different element", () => {
    expect(
      parseContentRequest({
        id: "request-1",
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1-2", expected },
      }),
    ).toBeNull();
  });

  it("rejects extra untrusted guard properties", () => {
    expect(
      parseContentRequest({
        id: "request-1",
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1-1", expected: { ...expected, value: "secret" } },
      }),
    ).toBeNull();
  });
});
