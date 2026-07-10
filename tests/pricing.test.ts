import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, STARTING_CREDITS } from "@/lib/pricing";

describe("credit pricing", () => {
  it("grants a positive starting balance", () => {
    expect(STARTING_CREDITS).toBeGreaterThan(0);
  });

  it("prices every paid action as a positive integer", () => {
    for (const [action, cost] of Object.entries(CREDIT_COSTS)) {
      expect(cost, action).toBeGreaterThan(0);
      expect(Number.isInteger(cost), action).toBe(true);
    }
  });

  it("keeps a full from-scratch video affordable within the starting balance", () => {
    const fullVideo =
      CREDIT_COSTS.repoAnalysis +
      CREDIT_COSTS.research +
      CREDIT_COSTS.angles +
      CREDIT_COSTS.brief +
      CREDIT_COSTS.render;
    expect(fullVideo).toBeLessThanOrEqual(STARTING_CREDITS);
  });

  it("makes render the most expensive single action", () => {
    const max = Math.max(...Object.values(CREDIT_COSTS));
    expect(CREDIT_COSTS.render).toBe(max);
  });
});
