import { describe, expect, it } from "vitest";
import { computeTipPosition } from "./infoTipPosition";

describe("computeTipPosition", () => {
  it("places the popover below the trigger when enough vertical space exists", () => {
    const pos = computeTipPosition(
      { top: 100, bottom: 126, left: 160, width: 26 },
      { width: 375, height: 812 },
    );
    expect(pos.top).toBe(132);
    expect(pos.bottom).toBeUndefined();
    expect(pos.width).toBe(280);
    expect(pos.left).toBe(33);
    expect(pos.maxHeight).toBe(812 - 84 - 132);
  });

  it("flips above the trigger near the bottom edge on mobile", () => {
    const pos = computeTipPosition(
      { top: 560, bottom: 586, left: 320, width: 26 },
      { width: 375, height: 667 },
    );
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(667 - (560 - 6));
    expect(pos.left).toBe(375 - 280 - 8);
    expect(pos.maxHeight).toBe(560 - 6 - 8);
  });

  it("respects mobile bottomInset when trigger sits close to the bottom bar", () => {
    const pos = computeTipPosition(
      { top: 610, bottom: 636, left: 10, width: 26 },
      { width: 375, height: 667 },
    );
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(84);
    expect(pos.left).toBe(8);
    expect(pos.maxHeight).toBe(667 - 84 - 8);
  });

  it("keeps popover below when spaceAbove is even smaller than spaceBelow", () => {
    const pos = computeTipPosition(
      { top: 40, bottom: 66, left: 200, width: 26 },
      { width: 320, height: 220 },
    );
    expect(pos.top).toBe(72);
    expect(pos.bottom).toBeUndefined();
    expect(pos.maxHeight).toBe(64);
  });
});
