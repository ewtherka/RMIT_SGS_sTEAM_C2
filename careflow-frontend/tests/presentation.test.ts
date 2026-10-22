import { describe, it, expect } from "vitest";
import { createApi } from "../src/api";
import { simulationLabel, simulationLabels } from "../src/presentation";

describe("demo display labels", () => {
  it("cleans doctor and patient suffixes without changing real words", () => {
    expect(simulationLabel("BS. Lan (giả)")).toBe("BS. Lan");
    expect(simulationLabel("BS. Minh (giả)")).toBe("BS. Minh");
    expect(simulationLabel("Nguyễn An (bệnh nhân giả)")).toBe("Nguyễn An");
    expect(simulationLabel("Từ chối giải mã")).toBe("Từ chối giải mã");
  });
  it("cleans nested display copy and keeps the simulation disclosure", () => {
    const result = simulationLabels({
      items: [
        {
          doctorName: "BS. Lan (giả)",
          clinic: {
            name: "CareFlow — cơ sở giả",
            address: "Địa điểm giả cho demo",
          },
          plaintext: "Kết quả mẫu (dữ liệu giả)",
          reason: "Dữ liệu giả cho demo",
        },
      ],
      message: "Mô phỏng TideCloak",
    });
    expect(JSON.stringify(result)).not.toMatch(/(?<!\p{L})giả(?!\p{L})/u);
    expect(result.message).toBe("Mô phỏng TideCloak");
  });
  it("does not alter tokens, ids, policy text or ciphertext, or mutate the response", () => {
    const original = {
      id: "giả",
      accessToken: "giả",
      ciphertext: "giả",
      policy: "giả",
      displayName: "BS. Lan (giả)",
    };
    expect(simulationLabels(original)).toEqual({
      ...original,
      displayName: "BS. Lan",
    });
    expect(original.displayName).toBe("BS. Lan (giả)");
  });
  it("applies presentation consistently to server-returned doctors and sessions", async () => {
    const http = async () =>
      Response.json([{ id: "doctor", displayName: "BS. Lan (giả)" }]);
    const api = createApi(undefined, "http://api.test", http);
    expect(await api.doctors()).toEqual([
      { id: "doctor", displayName: "BS. Lan" },
    ]);
  });
});
