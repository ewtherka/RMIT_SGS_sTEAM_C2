const { chromium } = require('playwright');
const { existsSync, mkdirSync, readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const apiOrigin = process.env.API_URL || 'http://localhost:3333';
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const errors = [];
let page;
let browser;
let passed = 0;
const log = text => { passed++; console.log(`PASS ${passed}: ${text}`); };
const doctorB = '40000000-0000-4000-8000-000000000002';
async function account(name) {
  await page.locator('.simulation-banner button').click();
  await page.getByRole('dialog').getByRole('button', { name }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}
async function route(name) { await page.goto(`${origin}/#/${name}`); }
async function navigate(name) { await page.evaluate(value => { location.hash = '/' + value; }, name); }
async function closeDialog() { await page.getByRole('button', { name: 'Đóng hộp thoại', exact: true }).click(); }
async function bookDoctor(name) {
  await navigate('doctors');
  const card = page.locator('.doctor-card').filter({ hasText: name });
  await card.getByRole('button', { name: 'Xem lịch trống' }).click();
  await page.locator('.time-option').first().click();
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  const response = page.waitForResponse(res => res.url() === `${apiOrigin}/v1/appointments` && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Xác nhận lịch hẹn', exact: true }).click();
  const result = await (await response).json(); assert.equal(result.status, 'CONFIRMED');
  await page.getByRole('heading', { name: 'Đặt lịch thành công!' }).waitFor();
  await page.getByRole('button', { name: 'Xem lịch hẹn của tôi' }).click();
  return result;
}
async function openFirstRecord() {
  await navigate('records');
  await page.locator('.medical-record-card').filter({ hasText: 'Kết quả mẫu' }).getByRole('button', { name: 'Xem tài liệu' }).click();
}
async function assertDenied() {
  await openFirstRecord();
  const response = page.waitForResponse(res => res.url().endsWith('/decrypt') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Kiểm tra và mở hồ sơ' }).click();
  assert.equal((await response).status(), 403);
  await page.getByRole('alert').filter({ hasText: /từ chối giải mã/ }).waitFor();
  assert.equal(await page.locator('.decrypted-record').count(), 0);
  await closeDialog();
}
async function requestAccess(intent) {
  await navigate('sharing');
  await page.locator('.sharing-card').filter({ hasText: 'Kết quả mẫu' }).getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  await page.getByLabel('Bác sĩ nhận yêu cầu').selectOption(doctorB);
  await page.getByLabel('Loại yêu cầu chia sẻ').selectOption(intent);
  const response = page.waitForResponse(res => res.url().includes('/access-requests') && res.request().method() === 'POST');
  await page.getByRole('dialog').getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  const result = await (await response).json(); assert.equal(result.status, 'PENDING_TIDE');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  return result.id;
}
async function approve(admin, requestId) {
  await account(admin);
  const card = page.locator('.approval-card').filter({ hasText: 'Kết quả mẫu' }).filter({ hasText: 'BS. Lan' });
  // Tests should be run against a dedicated synthetic database. The newest request is selected last if older fixtures exist.
  await card.last().getByRole('button', { name: 'Xem và phê duyệt' }).click();
  const response = page.waitForResponse(res => res.url().endsWith(`/approvals/${requestId}/approve`));
  await page.getByRole('button', { name: 'Xác nhận phê duyệt' }).click();
  const result = await (await response).json();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  return result;
}
(async () => {
  browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  mkdirSync('test-results', { recursive: true });
  const config = await (await page.request.get(`${apiOrigin}/v1/auth/config`)).json();
  assert.equal(config.mode, 'SIMULATED', 'Start the backend with TIDE_MODE=simulated');
  await route('records');
  await page.getByRole('heading', { name: 'Chăm sóc liền mạch, bắt đầu từ một kết nối.' }).waitFor();
  assert.equal(await page.locator('.medical-record-card').count(), 0); log('guest routes are gated');
  await account(/Nguyễn An/);
  await page.getByRole('heading', { name: /Chào Nguyễn An/ }).waitFor();
  await navigate('governance'); await page.getByRole('heading', { name: 'Chỉ quản trị viên được vào mục này' }).waitFor(); log('patient cannot open the admin route directly');
  const booking = await bookDoctor('BS. Minh'); log('booking is confirmed by the real simulated API');
  const appointmentCard = page.locator('.appointment-card').filter({ hasText: 'BS. Minh' }).filter({ hasText: 'Đã xác nhận' }).first();
  await appointmentCard.getByRole('button', { name: 'Chi tiết' }).click();
  await page.getByRole('button', { name: 'Đổi lịch', exact: true }).click();
  await page.locator('.time-option').first().click(); await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  const rescheduledResponse = page.waitForResponse(res => res.url().endsWith(`/${booking.id}/reschedule`));
  await page.getByRole('button', { name: 'Xác nhận lịch hẹn', exact: true }).click();
  const moved = await (await rescheduledResponse).json(); assert.equal(moved.id, booking.id); assert.ok(moved.version > booking.version);
  await page.getByRole('button', { name: 'Xem lịch hẹn của tôi' }).click(); log('reschedule uses the server version and preserves the appointment id');
  await page.locator('.appointment-card').filter({ hasText: 'BS. Minh' }).first().getByRole('button', { name: 'Chi tiết' }).click();
  const attendedResponse = page.waitForResponse(res => res.url().endsWith(`/${booking.id}/attendance-confirmation`));
  await page.getByRole('button', { name: 'Tôi sẽ đến', exact: true }).click();
  const attended = await (await attendedResponse).json(); assert.equal(attended.attendanceConfirmation, 'ATTENDING'); assert.equal(attended.version, moved.version);
  await page.getByRole('button', { name: 'Hủy lịch', exact: true }).click();
  const cancelledResponse = page.waitForResponse(res => res.url().endsWith(`/${booking.id}/cancel`));
  await page.getByRole('button', { name: 'Xác nhận hủy lịch' }).click();
  assert.equal((await (await cancelledResponse).json()).status, 'CANCELLED'); await closeDialog(); log('attendance and cancellation are persisted by the backend');
  await bookDoctor('BS. Lan');
  await openFirstRecord(); await page.getByRole('button', { name: 'Kiểm tra và mở hồ sơ' }).click();
  await page.locator('.decrypted-record pre').filter({ hasText: 'Kết quả mẫu' }).waitFor(); await closeDialog(); log('the patient can read their own record');
  await account(/BS\. Lan/); await assertDenied(); log('clinical assignment alone does not grant decryption');
  await account(/Nguyễn An/); const grantId = await requestAccess('GRANT');
  const first = await approve(/Admin độc lập 1/, grantId); assert.equal(first.quorum.reached, false); assert.equal(first.approvals.length, 1);
  await page.getByRole('button', { name: 'Bạn đã phê duyệt · Chờ admin khác' }).waitFor();
  await account(/BS\. Lan/); await assertDenied(); log('one independent approval still leaves the record closed');
  const second = await approve(/Admin độc lập 2/, grantId); assert.equal(second.quorum.reached, true); assert.equal(second.status, 'COMMITTED');
  await account(/BS\. Lan/); await openFirstRecord();
  await page.getByRole('button', { name: 'Kiểm tra và mở hồ sơ' }).click(); await page.locator('.decrypted-record pre').filter({ hasText: 'Kết quả mẫu' }).waitFor(); await closeDialog(); log('two independent approvals allow the selected record to be read');
  await page.locator('.medical-record-card').filter({ hasText: 'Lời dặn mẫu' }).getByRole('button', { name: 'Xem tài liệu' }).click();
  const stillDenied = page.waitForResponse(res => res.url().endsWith('/decrypt')); await page.getByRole('button', { name: 'Kiểm tra và mở hồ sơ' }).click(); assert.equal((await stillDenied).status(), 403); await closeDialog(); log('sharing one record does not open a second record');
  await account(/Nguyễn An/); const revokeId = await requestAccess('REVOKE');
  await approve(/Admin độc lập 1/, revokeId); await approve(/Admin độc lập 2/, revokeId);
  await account(/BS\. Lan/); await assertDenied(); log('revocation after quorum blocks subsequent decryption');
  assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('eyJ') || value.includes('Kết quả mẫu'))), false); log('tokens and plaintext are absent from localStorage');
  await account(/Nguyễn An/); await navigate('overview'); await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('h1').waitFor(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `horizontal overflow at ${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Mở điều hướng' }).click(); await page.locator('.sidebar nav').getByRole('link', { name: 'Tìm bác sĩ' }).click(); await page.getByRole('heading', { name: 'Tìm bác sĩ của bạn' }).waitFor();
  assert.equal(await page.locator('body').evaluate(element => element.classList.contains('nav-open')), false); log('responsive layouts and mobile navigation work at four widths');
  const relay = await page.request.get(`${origin}/tide_dpop/browser-test`); assert.equal(relay.status(), 200); assert.equal(relay.headers()['allow-csp-from'], '*'); assert.equal(relay.headers()['content-security-policy'], "default-src 'self'; script-src 'unsafe-inline'"); assert.equal(relay.headers()['x-frame-options'], undefined); assert.deepEqual(await relay.body(), readFileSync('../careflow-backend/public/tide_dpop_auth.html')); log('Tide relay bytes and security headers match the official file');
  assert.deepEqual(errors, [], 'uncaught browser errors');
  console.log(`\n${passed} browser scenarios passed; no uncaught JavaScript errors.`);
})().catch(async error => { console.error(error); if (page) await page.screenshot({ path: 'test-results/failure.png', fullPage: true }).catch(() => {}); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
