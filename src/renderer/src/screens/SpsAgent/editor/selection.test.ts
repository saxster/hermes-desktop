import { describe, expect, it } from "vitest";
import { safeCssColor } from "./selection";

describe("safeCssColor", () => {
  it("accepts hex, rgb, and named colors", () => {
    expect(safeCssColor("#fff")).toBe("#fff");
    expect(safeCssColor("#112233")).toBe("#112233");
    expect(safeCssColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(safeCssColor("rebeccapurple")).toBe("rebeccapurple");
  });

  it("rejects CSS injection vectors", () => {
    expect(
      safeCssColor('red; background: url("https://evil")'),
    ).toBeUndefined();
    expect(safeCssColor("url(https://evil)")).toBeUndefined();
    expect(safeCssColor("expression(alert(1))")).toBeUndefined();
    expect(safeCssColor("")).toBeUndefined();
    expect(safeCssColor(undefined)).toBeUndefined();
  });
});
