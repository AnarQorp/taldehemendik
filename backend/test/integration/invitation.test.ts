import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

describe("individual invitation", () => {
  it("does not expose player identity through public resolution", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/invitations/public-token-seeded-for-local-tests" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      team: { name: "S. D. Indautxu" },
      teamSeason: { seasonLabel: "2026/27", displayLabel: "Infantil A" },
      purpose: "GUARDIAN_LINK"
    });
    expect(response.body).not.toContain("Ibai");
    expect(response.body).not.toContain("9");
  });
});
