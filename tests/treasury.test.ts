import { describe, expect, it } from "vitest";
import { bpsFromPercent, formatAtomic } from "@/lib/treasury";

describe("treasury chain formatting", () => {
  it("formats 24-decimal NEAR and six-decimal stablecoins without floating-point loss", () => {
    expect(formatAtomic("12345678900000000000000000", 24, 4)).toBe("12.3456");
    expect(formatAtomic("15002500", 6, 4)).toBe("15.0025");
  });

  it("converts percentages to bounded basis points", () => {
    expect(bpsFromPercent(20)).toBe(2_000);
    expect(bpsFromPercent(250)).toBe(20_000);
    expect(bpsFromPercent(150, 10_000)).toBe(10_000);
    expect(bpsFromPercent(-5)).toBe(0);
  });
});
