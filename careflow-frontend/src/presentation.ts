// Presentation only: leave server identities, tokens, policies and ciphertext intact.
// Real Tide mode must never rewrite clinical content.
const labels = new Set([
  "name",
  "displayName",
  "doctorName",
  "patientName",
  "actorName",
  "description",
  "address",
  "arrivalInstructions",
  "title",
  "body",
  "message",
  "reason",
  "plaintext",
]);

export function simulationLabel(value: string): string {
  return value
    .replace(/\s*\((?:bệnh nhân\s+)?giả\)/giu, "")
    .replace(/cơ sở giả/giu, "cơ sở demo")
    .replace(/dữ liệu giả/giu, "dữ liệu mô phỏng")
    .replace(/dịch vụ giả/giu, "Dịch vụ demo")
    .replace(/địa điểm giả/giu, "Địa điểm demo")
    .replace(/(?<![\p{L}\p{N}_])giả(?![\p{L}\p{N}_])/giu, "mô phỏng");
}

export function simulationLabels<T>(value: T): T {
  if (Array.isArray(value)) return value.map(simulationLabels) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" && labels.has(key)
        ? simulationLabel(item)
        : simulationLabels(item),
    ]),
  ) as T;
}
