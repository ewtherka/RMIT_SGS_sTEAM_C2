import { createContext, useContext } from "react";
import type { Api } from "./api";
import type { Me } from "./types";
export type SessionStatus =
  "loading" | "unconfigured" | "error" | "guest" | "authenticated";
export interface Session {
  mode?: "simulation" | "tide";
  showAccounts?: () => void;
  status: SessionStatus;
  me: Me | null;
  api: Api;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
  reloadMe: () => Promise<void>;
  decrypt?: (
    recordId: string,
    ciphertext: string,
    policy: Uint8Array,
  ) => Promise<string>;
  encrypt?: (
    recordId: string,
    plaintext: string,
    policy: Uint8Array,
  ) => Promise<string>;
}
export const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session provider missing");
  return value;
}
