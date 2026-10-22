import type { Appointment, Me } from "./types";
export const zone = "Asia/Ho_Chi_Minh";
export const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: zone }).format(new Date());
export const dateOf = (value: string | number) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: zone }).format(new Date(value));
export const dateText = (value: string | number, full = false) =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    ...(full ? { year: "numeric" } : {}),
    timeZone: zone,
  }).format(
    new Date(
      typeof value === "string" && value.length === 10
        ? `${value}T12:00:00+07:00`
        : value,
    ),
  );
export const timeText = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(value));
export const weekday = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", { weekday: "long", timeZone: zone }).format(
    new Date(`${value}T12:00:00+07:00`),
  );
export const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const money = (value: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(
    value,
  );
export const initials = (name: string) =>
  name
    .replace(/\([^)]*\)/g, "")
    .replace(/BS\.?/g, "")
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
export const hasRole = (me: Me | null, role: string) =>
  Boolean(
    me?.roles.some((value) => value === role || value === `careflow-${role}`),
  );
export const canPatientChange = (appointment: Appointment) =>
  appointment.status === "CONFIRMED";
export const canAttend = (appointment: Appointment) =>
  canPatientChange(appointment) &&
  appointment.disruptionStatus === "NONE" &&
  appointment.attendanceConfirmation !== "ATTENDING";
export const statusLabels: Record<Appointment["status"], string> = {
  CONFIRMED: "Đã xác nhận",
  CHECKED_IN: "Đã check-in",
  IN_PROGRESS: "Đang khám",
  COMPLETED: "Đã hoàn thành",
  CANCELLED: "Đã hủy",
  NO_SHOW: "Vắng mặt",
};
export const decodeBase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
export const encodeBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
