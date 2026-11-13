import { describe, expect, it } from "vitest";
import { formatNear, parseNear, parseTokenAmount, sumNear } from "@/lib/amounts";

describe("NEAR amount conversion", () => {
  it("converts decimal NEAR to yoctoNEAR without floating point", () => {
    expect(parseNear("1.25")).toBe(1_250_000_000_000_000_000_000_000n);
  });

  it("formats and sums amounts", () => {
    expect(sumNear(["1.25", "0.75"])).toBe(2_000_000_000_000_000_000_000_000n);
    expect(formatNear(parseNear("2.5000"))).toBe("2.5");
  });

  it("rejects negative and over-precise values", () => {
    expect(() => parseNear("-1")).toThrow();
    expect(() => parseNear("0.0000000000000000000000001")).toThrow();
  });

  it("converts stablecoin amounts using six decimals", () => {
    expect(parseTokenAmount("125.50", "USDC")).toBe(125_500_000n);
    expect(parseTokenAmount("1.000001", "USDT")).toBe(1_000_001n);
    expect(() => parseTokenAmount("1.0000001", "USDC")).toThrow();
  });
});
