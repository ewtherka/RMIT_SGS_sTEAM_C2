import type {
  AccessRequest,
  Appointment,
  AuthConfig,
  AvailabilityQuery,
  BookingInput,
  Clinic,
  Doctor,
  FollowUp,
  Me,
  MedicalRecord,
  Notification,
  Page,
  Policies,
  Service,
  Sharing,
  Visit,
} from "./types";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const apiOrigin = (() => {
  const url = new URL(
    import.meta.env.VITE_API_BASE_URL || "http://localhost:3333",
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "VITE_API_BASE_URL phải là HTTP(S) origin, không chứa đường dẫn hoặc thông tin đăng nhập.",
    );
  return url.origin;
})();

export function createApi(
  secure?: Fetcher,
  origin = apiOrigin,
  publicFetch: Fetcher = fetch,
) {
  async function request<T>(
    path: string,
    options: RequestInit = {},
    authenticated = true,
  ): Promise<T> {
    if (authenticated && !secure)
      throw new ApiError(
        "AUTH_REQUIRED",
        "Vui lòng đăng nhập bằng Tide để tiếp tục.",
        401,
      );
    const headers = new Headers(options.headers);
    if (options.body) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await (authenticated ? secure! : publicFetch)(
        `${origin}${path}`,
        {
          ...options,
          headers,
          cache: "no-store",
          credentials: "omit",
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
            : AbortSignal.timeout(15000),
        },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      throw new ApiError(
        "NETWORK_ERROR",
        "Không kết nối được máy chủ. Kiểm tra kết nối rồi thử lại.",
      );
    }
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        data?.code || "HTTP_ERROR",
        data?.message || "Yêu cầu chưa được xử lý. Vui lòng thử lại.",
        response.status,
        data?.requestId,
      );
    if (data === null)
      throw new ApiError(
        "INVALID_RESPONSE",
        "Máy chủ trả về dữ liệu không hợp lệ.",
      );
    return data as T;
  }
  function query(values: object) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined && value !== "") params.set(key, String(value));
    return params.toString();
  }
  const mutation = <T>(path: string, body: unknown, key: string) =>
    request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": key },
    });
  return {
    simAccessLog: (id: string) =>
      request<{
        recordId: string;
        items: {
          action: string;
          actorId: string;
          actorName: string;
          at: string;
        }[];
      }>(`/v1/sim/records/${encodeURIComponent(id)}/access-log`),
    simIdentities: () =>
      request<import("./types").SimIdentity[]>("/v1/sim/identities", {}, false),
    simLogin: (userId: string) =>
      request<import("./types").SimLogin>(
        "/v1/sim/session",
        { method: "POST", body: JSON.stringify({ userId }) },
        false,
      ),
    simApprovals: () =>
      request<{
        quorum: { threshold: number; of: number };
        items: import("./types").SimApproval[];
      }>("/v1/sim/approvals"),
    simApprove: (id: string) =>
      request<import("./types").SimApproval>(
        `/v1/sim/approvals/${encodeURIComponent(id)}/approve`,
        { method: "POST" },
      ),
    simAccess: (id: string) =>
      request<import("./types").SimAccess>(
        `/v1/sim/records/${encodeURIComponent(id)}/access`,
      ),
    simDecrypt: (id: string) =>
      request<{ recordId: string; plaintext: string; allowedBy: string }>(
        `/v1/sim/records/${encodeURIComponent(id)}/decrypt`,
        { method: "POST" },
      ),
    authConfig: () => request<AuthConfig>("/v1/auth/config", {}, false),
    clinics: (signal?: AbortSignal) =>
      request<Clinic[]>("/v1/clinics", { signal }, false),
    services: () => request<Service[]>("/v1/services", {}, false),
    doctors: (serviceId?: string) =>
      request<Doctor[]>(`/v1/doctors?${query({ serviceId })}`, {}, false),
    availability: (values: AvailabilityQuery, signal?: AbortSignal) =>
      request<SlotArray>(
        `/v1/availability?${query(values)}`,
        { signal },
        false,
      ),
    me: () => request<Me>("/v1/me"),
    onboard: (body: {
      displayName: string;
      clinicId: string;
      phone?: string;
      email?: string;
      dateOfBirth?: string;
    }) =>
      request("/v1/me/onboarding", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    patchProfile: (body: {
      displayName: string;
      phone?: string;
      email?: string;
    }) =>
      request<Me>("/v1/me", { method: "PATCH", body: JSON.stringify(body) }),
    appointments: (offset = 0) =>
      request<Page<Appointment>>(`/v1/appointments?limit=30&offset=${offset}`),
    appointment: (id: string) =>
      request<Appointment>(`/v1/appointments/${encodeURIComponent(id)}`),
    book: (body: BookingInput, key: string) =>
      mutation<Appointment>("/v1/appointments", body, key),
    reschedule: (
      id: string,
      body: { doctorId: string; startsAt: string; expectedVersion: number },
      key: string,
    ) =>
      mutation<Appointment>(
        `/v1/appointments/${encodeURIComponent(id)}/reschedule`,
        body,
        key,
      ),
    appointmentAction: (
      id: string,
      action: "cancel" | "attendance-confirmation" | "start" | "complete",
      version: number,
      key: string,
    ) =>
      mutation<Appointment>(
        `/v1/appointments/${encodeURIComponent(id)}/${action}`,
        { expectedVersion: version },
        key,
      ),
    alternatives: (id: string, from: string, to: string) =>
      request<SlotArray>(
        `/v1/appointments/${encodeURIComponent(id)}/alternatives?${query({ from, to })}`,
      ),
    records: (offset = 0) =>
      request<Page<MedicalRecord>>(`/v1/records?limit=30&offset=${offset}`),
    policies: (id: string) =>
      request<Policies>(`/v1/records/${encodeURIComponent(id)}/policy`),
    sharing: () => request<Sharing>("/v1/me/sharing"),
    accessIntent: (id: string, doctorId: string, intent: "GRANT" | "REVOKE") =>
      request<AccessRequest>(
        `/v1/records/${encodeURIComponent(id)}/access-requests`,
        { method: "POST", body: JSON.stringify({ doctorId, intent }) },
      ),
    visits: (offset = 0) =>
      request<Page<Visit>>(`/v1/me/visits?limit=30&offset=${offset}`),
    visit: (id: string) =>
      request<Visit>(`/v1/me/visits/${encodeURIComponent(id)}`),
    followUps: () => request<FollowUp[]>("/v1/me/follow-ups"),
    notifications: (offset = 0) =>
      request<Page<Notification>>(
        `/v1/me/notifications?limit=30&offset=${offset}`,
      ),
    readNotification: (id: string) =>
      request(`/v1/me/notifications/${encodeURIComponent(id)}/read`, {
        method: "PATCH",
      }),
    draftRecord: (
      appointmentId: string,
      title: string,
      kind: MedicalRecord["kind"],
    ) =>
      request<MedicalRecord>("/v1/records/drafts", {
        method: "POST",
        body: JSON.stringify({ appointmentId, title, kind }),
      }),
    recordContent: (id: string, ciphertext: string, expectedVersion: number) =>
      request<MedicalRecord>(`/v1/records/${encodeURIComponent(id)}/content`, {
        method: "PUT",
        body: JSON.stringify({
          ciphertext,
          expectedVersion,
          tags: [id],
          encryptionScheme: "TIDE_RELATIONSHIP_ATTESTATION_V1",
        }),
      }),
    releaseRecord: (id: string, expectedVersion: number) =>
      request<MedicalRecord>(`/v1/records/${encodeURIComponent(id)}/release`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion }),
      }),
  };
}
type SlotArray = import("./types").Slot[];
export type Api = ReturnType<typeof createApi>;
export const publicApi = createApi();

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      SLOT_UNAVAILABLE: "Khung giờ vừa được đặt. Vui lòng chọn giờ khác.",
      VERSION_CONFLICT:
        "Lịch hẹn đã thay đổi. Dữ liệu mới nhất đang được tải lại.",
      IDEMPOTENCY_MISMATCH:
        "Yêu cầu không khớp lần gửi trước. Vui lòng tải lại dữ liệu.",
      TIDE_NOT_CONFIGURED:
        "Đăng nhập Tide chưa được cấu hình. Bạn vẫn có thể tìm bác sĩ và lịch trống.",
      NO_CARE_RELATIONSHIP:
        "Bác sĩ này chưa có lịch khám được phân công cho bạn.",
      AUTH_REQUIRED: "Vui lòng đăng nhập để tiếp tục.",
    };
    return messages[error.code] || error.message;
  }
  return error instanceof Error
    ? error.message
    : "Có lỗi xảy ra. Vui lòng thử lại.";
}
