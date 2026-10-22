const { chromium } = require("playwright");
const { existsSync, mkdirSync } = require("node:fs");
const assert = require("node:assert/strict");
const origin = process.env.FRONTEND_URL || "http://localhost:5173";
const apiOrigin = process.env.API_URL || "http://localhost:3333";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
let browser, page, appointmentId, emergencyId;
const errors = [];
async function account(name) {
  await page.locator(".simulation-banner button").click();
  await page.getByRole("dialog").getByRole("button", { name }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
}
async function navigate(route) {
  await page.evaluate((value) => {
    location.hash = "/" + value;
  }, route);
}
async function openRecord(title = "Kết quả mẫu") {
  await navigate("records");
  await page
    .locator(".medical-record-card")
    .filter({ hasText: title })
    .getByRole("button", { name: "Xem tài liệu" })
    .click();
}
async function decrypt(status) {
  const response = page.waitForResponse(
    (res) =>
      res.url().endsWith("/decrypt") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Kiểm tra và mở hồ sơ" }).click();
  assert.equal((await response).status(), status);
  if (status >= 200 && status < 300) await page.locator(".decrypted-record pre").waitFor();
  else {
    await page
      .getByRole("alert")
      .filter({ hasText: /từ chối giải mã/ })
      .waitFor();
    assert.equal(await page.locator(".decrypted-record").count(), 0);
  }
}
async function closeRecord() {
  await page
    .getByRole("button", { name: "Đóng hộp thoại", exact: true })
    .click();
}
async function approve(admin, count) {
  await account(admin);
  await page
    .locator(".emergency-approval-card")
    .filter({ hasText: "Kết quả mẫu" })
    .getByRole("button", { name: "Duyệt yêu cầu khẩn cấp" })
    .click();
  const response = page.waitForResponse((res) =>
    res.url().endsWith(`/emergency-requests/${emergencyId}/approve`),
  );
  await page
    .getByRole("button", { name: "Xác nhận duyệt khẩn cấp", exact: true })
    .click();
  const result = await (await response).json();
  assert.equal(result.approvals.length, count);
  assert.equal(result.status, count === 2 ? "COMMITTED" : "PENDING_TIDE");
  if (count === 2) assert.ok(Date.parse(result.expiresAt) > Date.now());
  await page.getByRole("dialog").waitFor({ state: "detached" });
}
async function patientRequest(path, options = {}) {
  const response = await fetch(`${apiOrigin}/v1/sim/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "30000000-0000-4000-8000-000000000001" }),
  });
  const session = await response.json();
  return fetch(`${apiOrigin}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
  });
}
(async () => {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await account(/Nguyễn An/);
  await navigate("doctors");
  await page
    .locator(".doctor-card")
    .filter({ hasText: "BS. Lan" })
    .getByRole("button", { name: "Xem lịch trống" })
    .click();
  await page.locator(".date-option").last().click();
  await page.locator(".time-option").first().click();
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  const booked = page.waitForResponse(
    (res) =>
      res.url() === `${apiOrigin}/v1/appointments` &&
      res.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Xác nhận lịch hẹn", exact: true })
    .click();
  const appointment = await (await booked).json();
  assert.equal(appointment.status, "CONFIRMED");
  appointmentId = appointment.id;
  await page.getByRole("button", { name: "Xem lịch hẹn của tôi" }).click();
  await account(/BS\. Lan/);
  await openRecord();
  await decrypt(403);
  await page
    .getByRole("button", { name: "Yêu cầu truy cập khẩn cấp", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Yêu cầu truy cập khẩn cấp",
    exact: true,
  });
  assert.equal(
    await modal
      .getByRole("button", { name: "Gửi yêu cầu khẩn cấp" })
      .isDisabled(),
    true,
  );
  const reason =
    "Dữ liệu giả: cần xem kết quả trong tình huống cấp cứu minh họa.";
  await modal
    .getByRole("textbox", { name: "Lý do truy cập khẩn cấp" })
    .fill(reason);
  const requested = page.waitForResponse(
    (res) =>
      res.url().endsWith("/emergency-requests") &&
      res.request().method() === "POST",
  );
  await modal.getByRole("button", { name: "Gửi yêu cầu khẩn cấp" }).click();
  const emergency = await (await requested).json();
  assert.equal(emergency.status, "PENDING_TIDE");
  emergencyId = emergency.id;
  await modal.waitFor({ state: "detached" });
  await closeRecord();
  console.log(
    "PASS emergency 1: active clinician requests a reasoned, scoped emergency; short reason is disabled",
  );
  await approve(/Admin độc lập 1/, 1);
  await page
    .getByRole("button", { name: "Bạn đã duyệt · Chờ admin độc lập khác" })
    .waitFor();
  await account(/BS\. Lan/);
  await openRecord();
  await decrypt(403);
  await closeRecord();
  console.log(
    "PASS emergency 2: one independent admin is insufficient, duplicate vote disabled",
  );
  await approve(/Admin độc lập 2/, 2);
  await account(/BS\. Lan/);
  await openRecord();
  await decrypt(201);
  await closeRecord();
  await openRecord("Lời dặn mẫu");
  await decrypt(403);
  await closeRecord();
  console.log(
    "PASS emergency 3: two independent approvals open only the requested record, with expiry",
  );
  await account(/Nguyễn An/);
  await navigate("sharing");
  const card = page.locator(".sharing-card").filter({ hasText: "Kết quả mẫu" });
  await card
    .locator(".emergency-panel.active")
    .getByText(reason, { exact: true })
    .waitFor();
  await card
    .getByRole("button", { name: "Kết thúc ngay", exact: true })
    .click();
  const ended = page.waitForResponse((res) =>
    res.url().endsWith(`/emergency-requests/${emergencyId}/end`),
  );
  await page
    .getByRole("button", { name: "Kết thúc quyền khẩn cấp", exact: true })
    .click();
  assert.equal((await (await ended).json()).status, "ENDED");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await account(/BS\. Lan/);
  await openRecord();
  await decrypt(403);
  await closeRecord();
  assert.deepEqual(errors, []);
  console.log(
    "PASS emergency 4: patient sees the reason and ends access; server blocks the next decrypt",
  );
})()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    mkdirSync("test-results", { recursive: true });
    await page
      ?.screenshot({
        path: "test-results/emergency-failure.png",
        fullPage: true,
      })
      .catch(() => {});
  })
  .finally(async () => {
    if (emergencyId)
      await patientRequest(`/v1/sim/emergency-requests/${emergencyId}/end`, {
        method: "POST",
      }).catch(() => {});
    if (appointmentId) {
      const response = await patientRequest(
        `/v1/appointments/${appointmentId}`,
      );
      const appointment = await response.json();
      if (appointment.status === "CONFIRMED")
        await patientRequest(`/v1/appointments/${appointmentId}/cancel`, {
          method: "POST",
          body: JSON.stringify({ expectedVersion: appointment.version }),
        });
    }
    await browser?.close();
  });
