import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { TideCloakContextProvider, useTideCloak } from "@tidecloak/react";
import { IAMService } from "@tidecloak/js";
import { createApi, errorMessage } from "./api";
import { SessionContext } from "./session-context";
import { decodeBase64, encodeBase64 } from "./utils";
import type { AuthConfig, Me } from "./types";

function Bridge({
  children,
  retry,
}: {
  children: ReactNode;
  retry: () => void;
}) {
  const sdk = useTideCloak();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secure = useCallback(
    (url: string, init?: RequestInit) => IAMService.secureFetch(url, init),
    [],
  );
  const api = useMemo(
    () => createApi(sdk.authenticated ? secure : undefined),
    [sdk.authenticated, secure],
  );
  const reloadMe = useCallback(async () => {
    const result = await api.me();
    setMe(result);
    setError(null);
  }, [api]);
  useEffect(() => {
    let active = true;
    setMe(null);
    setError(null);
    if (sdk.authenticated)
      api
        .me()
        .then((value) => {
          if (active) setMe(value);
        })
        .catch((reason) => {
          if (active) setError(errorMessage(reason));
        });
    return () => {
      active = false;
    };
  }, [api, sdk.authenticated]);
  const logout = useCallback(async () => {
    // Unmount private screens before returning control to the SDK.
    setMe(null);
    setError(null);
    await sdk.logout();
  }, [sdk.logout]);
  return (
    <SessionContext.Provider
      value={{
        status: sdk.isInitializing
          ? "loading"
          : sdk.initError
            ? "error"
            : sdk.authenticated
              ? "authenticated"
              : "guest",
        me,
        api,
        error: sdk.initError
          ? "Không khởi tạo được phiên Tide. Kiểm tra cấu hình rồi thử lại."
          : error,
        retry,
        login: sdk.login,
        logout,
        reloadMe,
        decrypt: async (recordId, ciphertext, policy) => {
          const values = await IAMService.doDecrypt(
            [{ encrypted: decodeBase64(ciphertext), tags: [recordId] }],
            policy,
          );
          if (!values.length)
            throw new Error("Tide chưa trả về nội dung giải mã.");
          return typeof values[0] === "string"
            ? values[0]
            : new TextDecoder().decode(values[0]);
        },
        encrypt: async (recordId, plaintext, policy) => {
          const values = await IAMService.doEncrypt(
            [{ data: new TextEncoder().encode(plaintext), tags: [recordId] }],
            policy,
          );
          if (!values.length)
            throw new Error("Tide chưa trả về dữ liệu mã hóa.");
          return typeof values[0] === "string"
            ? values[0]
            : encodeBase64(values[0]);
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export default function TideSession({
  config,
  retry,
  children,
}: {
  config: AuthConfig;
  retry: () => void;
  children: ReactNode;
}) {
  const settings = useMemo(
    () => ({
      ...config.adapter,
      useDPoP: { mode: "strict", alg: "ES256" },
      redirectUri: `${window.location.origin}/auth/redirect`,
    }),
    [config.adapter],
  );
  return (
    <TideCloakContextProvider config={settings}>
      <Bridge retry={retry}>{children}</Bridge>
    </TideCloakContextProvider>
  );
}
