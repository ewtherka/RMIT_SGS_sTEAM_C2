import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { errorMessage, publicApi } from "./api";
import { SessionContext } from "./session-context";
import type { AuthConfig } from "./types";
const TideSession = lazy(() => import("./tide-session"));
const SimulationSession = lazy(() => import("./simulation/BackendSession"));
export function AuthProvider({ children }: { children: ReactNode }) {
  const mode = import.meta.env.VITE_AUTH_MODE || "simulation";
  if (!["simulation", "tide"].includes(mode))
    throw new Error("VITE_AUTH_MODE chỉ nhận simulation hoặc tide.");
  if (mode === "simulation") {
    return (
      <Suspense fallback={<div role="status">Đang khởi tạo CareFlow…</div>}>
        <SimulationSession>{children}</SimulationSession>
      </Suspense>
    );
  }
  return <LiveAuthProvider>{children}</LiveAuthProvider>;
}
function LiveAuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    publicApi
      .authConfig()
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch((reason) => {
        if (active) {
          setConfig(null);
          setError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const guest = (status: "loading" | "unconfigured" | "error") => (
    <SessionContext.Provider
      value={{
        mode: "tide",
        status,
        me: null,
        api: publicApi,
        error,
        retry,
        login: async () => {
          retry();
        },
        logout: async () => {},
        reloadMe: async () => {},
      }}
    >
      {children}
    </SessionContext.Provider>
  );
  if (loading) return guest("loading");
  if (error) return guest("error");
  if (!config?.configured || !config.adapter) return guest("unconfigured");
  return (
    <Suspense fallback={guest("loading")}>
      <TideSession config={config} retry={retry}>
        {children}
      </TideSession>
    </Suspense>
  );
}
