import { describe, it, expect } from "vitest";
import { gameModeLabel } from "./game-mode";

describe("gameModeLabel", () => {
  it("labels General mode", () => {
    expect(gameModeLabel(0)).toBe("General Mode");
  });

  it("labels Poker mode", () => {
    expect(gameModeLabel(1)).toBe("Poker Mode");
  });

  it("labels Pool mode", () => {
    expect(gameModeLabel(2)).toBe("Pool Mode");
  });
});
