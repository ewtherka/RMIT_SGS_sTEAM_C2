import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  apiOrigin,
  createApi,
  errorMessage,
  publicApi,
  type Fetcher,
} from "../api";
import { SessionContext } from "../session-context";
import { hasRole } from "../utils";
import type { Me } from "../types";
import {
  Avatar,
  Badge,
  ErrorBox,
  Icon,
  Loading,
  Modal,
  Notice,
  useResource,
} from "../ui";

// The token is issued and verified by D's explicit simulated backend. It never enters browser storage.
export function simulatedTransport(
  token: string,
  expired: () => void = () => {},
): Fetcher {
  return async (url, options = {}) => {
    if (new URL(url).origin !== apiOrigin)
      throw new Error("Từ chối gửi phiên mô phỏng đến origin khác.");
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) expired();
    return response;
  };
}
export default function BackendSession({ children }: { children: ReactNode }) {
  const [login, setLogin] = useState<{ token: string; me: Me } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const config = useResource(() => publicApi.authConfig(), []);
  const identities = useResource(
    async () =>
      config.value?.mode === "SIMULATED" ? publicApi.simIdentities() : [],
    [config.value?.mode],
  );
  const expired = useCallback(() => setLogin(null), []);
  const api = useMemo(
    () =>
      login ? createApi(simulatedTransport(login.token, expired)) : publicApi,
    [login?.token, expired],
  );
  const configured =
    config.value?.mode === "SIMULATED" && config.value.configured;
  const status = config.loading
    ? "loading"
    : config.error || !configured
      ? "error"
      : login
        ? "authenticated"
        : "guest";
  const problem = config.error
    ? errorMessage(config.error)
    : !config.loading && !configured
      ? "Back-end chưa bật TIDE_MODE=simulated. Chạy đúng chế độ hoặc chọn VITE_AUTH_MODE=tide để dùng Tide thật."
      : null;
  async function choose(userId: string) {
    if (busy) return;
    setBusy(userId);
    setError(null);
    try {
      const result = await publicApi.simLogin(userId);
      if (result.mode !== "SIMULATED" || result.tokenType !== "Bearer")
        throw new Error("Máy chủ không trả về phiên mô phỏng hợp lệ.");
      const me = await createApi(simulatedTransport(result.accessToken)).me();
      setLogin({ token: result.accessToken, me });
      setChoosing(false);
      window.location.hash = hasRole(me, "admin")
        ? "/governance"
        : hasRole(me, "doctor")
          ? "/doctor"
          : "/overview";
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy("");
    }
  }
  return (
    <SessionContext.Provider
      value={{
        mode: "simulation",
        status,
        me: login?.me || null,
        api,
        error: problem,
        login: async () => setChoosing(true),
        showAccounts: () => setChoosing(true),
        logout: async () => {
          setLogin(null);
          setError(null);
          window.location.hash = "/overview";
        },
        retry: config.reload,
        reloadMe: async () => {
          if (login) {
            const me = await api.me();
            setLogin({ ...login, me });
          }
        },
        decrypt: async (id) => (await api.simDecrypt(id)).plaintext,
      }}
    >
      {children}
      {choosing && (
        <Modal
          title="Trải nghiệm đăng nhập TideCloak"
          subtitle="Phiên mô phỏng do máy chủ cấp; quyền được kiểm tra ở API."
          onClose={busy ? () => {} : () => setChoosing(false)}
          wide
          footer={
            <>
              <span className="simulation-login-note">
                <Icon name="shield" />
                SIMULATED · Không phải mạng Tide thật
              </span>
              <Badge color="blue">Quorum 2 / 3 admin</Badge>
            </>
          }
        >
          {Boolean(error) && <ErrorBox error={error} />}
          {config.loading || identities.loading ? (
            <Loading />
          ) : problem || identities.error ? (
            <ErrorBox
              error={problem || identities.error}
              retry={() => {
                config.reload();
                identities.reload();
              }}
            />
          ) : (
            <div className="simulation-accounts">
              {identities.value?.map((identity, index) => (
                <button
                  key={identity.userId}
                  className={`simulation-account ${login?.me.id === identity.userId ? "current" : ""}`}
                  disabled={Boolean(busy)}
                  onClick={() => choose(identity.userId)}
                >
                  <Avatar
                    name={identity.displayName}
                    index={index}
                    size="medium"
                  />
                  <div>
                    <span>
                      {identity.roles.some((role) => role.endsWith("admin"))
                        ? "Quản trị độc lập"
                        : identity.roles.some((role) => role.endsWith("doctor"))
                          ? "Bác sĩ"
                          : identity.roles.some((role) =>
                                role.endsWith("receptionist"),
                              )
                            ? "Lễ tân"
                            : "Bệnh nhân"}
                    </span>
                    <strong>{identity.displayName}</strong>
                    <p>
                      {busy === identity.userId
                        ? "Đang xác minh phiên với máy chủ…"
                        : identity.roles.some((role) => role.endsWith("admin"))
                          ? "Mỗi admin chỉ có một phiếu. Không tự đọc được hồ sơ."
                          : identity.roles.some((role) =>
                                role.endsWith("doctor"),
                              )
                            ? "Có lịch khám không đồng nghĩa có quyền đọc bệnh án."
                            : "Trải nghiệm theo vai trò do máy chủ xác minh."}
                    </p>
                  </div>
                  <Icon name={busy === identity.userId ? "refresh" : "arrow"} />
                </button>
              ))}
            </div>
          )}
          <Notice>
            Đây là mô phỏng sign-in, role và policy bằng API của dự án. JWT mô
            phỏng chỉ giữ trong bộ nhớ; chưa sử dụng mạng Tide hoặc E2EE thật.
          </Notice>
        </Modal>
      )}
    </SessionContext.Provider>
  );
}
