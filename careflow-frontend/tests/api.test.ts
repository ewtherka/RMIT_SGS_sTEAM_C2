import { describe, it, expect, vi } from "vitest";
import { createApi } from "../src/api";
import { canAttend, canPatientChange, dateText, timeText } from "../src/utils";
import type { Appointment } from "../src/types";

describe("API contract and session boundary", () => {
  it("never calls private HTTP routes without an authenticated transport", async () => {
    const http = vi.fn();
    const api = createApi(undefined, "http://api.test", http);
    await expect(api.me()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(http).not.toHaveBeenCalled();
  });
  it("uses public catalog endpoints and direct arrays", async () => {
    const http = vi.fn(async () => Response.json([{ id: "service" }]));
    const api = createApi(undefined, "http://api.test", http);
    expect(await api.services()).toEqual([{ id: "service" }]);
    expect(http.mock.calls[0][0]).toBe("http://api.test/v1/services");
  });
  it("passes the absolute API URL to the secure SDK transport without inventing auth headers", async () => {
    const http = vi.fn(async () => Response.json({ id: "appointment" }));
    const api = createApi(http, "http://api.test");
    const body = {
      doctorId: "doctor",
      serviceId: "service",
      startsAt: "2026-10-23T02:00:00Z",
    };
    await api.book(body, "operation-key-1");
    const [url, options] = http.mock.calls[0];
    expect(url).toBe("http://api.test/v1/appointments");
    expect(JSON.parse(String(options?.body))).toEqual(body);
    expect(new Headers(options?.headers).get("Idempotency-Key")).toBe(
      "operation-key-1",
    );
    expect(new Headers(options?.headers).has("Authorization")).toBe(false);
  });
  it("uses POST reschedule with expectedVersion, not PATCH or date/time/reason", async () => {
    const http = vi.fn(async () => Response.json({ version: 3 }));
    const api = createApi(http, "http://api.test");
    await api.reschedule(
      "appointment",
      {
        doctorId: "doctor",
        startsAt: "2026-10-23T02:00:00Z",
        expectedVersion: 2,
      },
      "reschedule-key",
    );
    expect(http.mock.calls[0][0]).toBe(
      "http://api.test/v1/appointments/appointment/reschedule",
    );
    expect(http.mock.calls[0][1]?.method).toBe("POST");
    expect(
      JSON.parse(String(http.mock.calls[0][1]?.body)).expectedVersion,
    ).toBe(2);
  });
  it("preserves machine-readable conflicts and correlation id", async () => {
    const api = createApi(
      async () =>
        Response.json(
          {
            code: "VERSION_CONFLICT",
            message: "Changed",
            requestId: "request-1",
          },
          { status: 409 },
        ),
      "http://api.test",
    );
    await expect(api.appointments()).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      requestId: "request-1",
    });
  });
  it("keeps booking actions aligned with backend states", () => {
    for (const status of [
      "CHECKED_IN",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
      "NO_SHOW",
    ])
      expect(canPatientChange({ status } as Appointment)).toBe(false);
    expect(
      canAttend({
        status: "CONFIRMED",
        disruptionStatus: "ACTION_REQUIRED",
      } as Appointment),
    ).toBe(false);
    expect(
      canAttend({
        status: "CONFIRMED",
        disruptionStatus: "NONE",
        attendanceConfirmation: "UNANSWERED",
      } as Appointment),
    ).toBe(true);
  });
  it("renders backend UTC timestamps in Vietnam time", () => {
    expect(timeText("2026-10-23T02:30:00Z")).toBe("09:30");
    expect(dateText("2026-10-22T18:30:00Z", true)).toBe("23/10/2026");
  });
});
