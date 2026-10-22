# Hợp đồng tích hợp cho nhóm frontend

Backend tại `http://localhost:3333`, Swagger `/docs`, JSON `/openapi.json`; file snapshot [openapi.json](openapi.json). Frontend không nằm trong repo. Catalog và availability công khai; các endpoint còn lại cần token Tide và DPoP proof hợp lệ. Trạng thái cài đặt thực tế ở [VERIFICATION.md](VERIFICATION.md).

## Đăng nhập và DPoP

Lấy `GET /v1/auth/config`. Khi `configured:false`, dừng thao tác đăng nhập và hiển thị lỗi setup, không dùng mock token. Sau khi Tide bootstrap hoàn tất, response chứa adapter **public client**, không có secret, giữ nguyên cả các key `client-origin-auth-<origin>`. Chỉ tải cấu hình từ backend tin cậy.

Tích hợp SDK React theo [tài liệu Tide chính thức](https://docs.tide.org/). `useDPoP` nằm **trong config** của provider: `{ ...adapter, useDPoP: { mode: 'strict', alg: 'ES256' } }`. Không truyền `useDPoP` làm JSX prop rời. Đăng nhập và mọi thao tác mật mã chạy trong phiên browser của chính người dùng.

Gọi API bằng `secureFetch` của phiên SDK đã đăng nhập; dùng URL tuyệt đối `http://localhost:3333/v1/...`. SDK phải ký cho đúng origin/path của API, không ký URL frontend rồi chuyển tiếp. Header gồm `Authorization: DPoP <access_token>` và `DPoP: <fresh-proof>`. `Bearer` đơn lẻ bị từ chối. Mỗi retry cần proof mới, giữ nguyên `Idempotency-Key` và body của thao tác cũ.

Frontend origin mặc định `http://localhost:5173`; CORS cũng cho phép cụ thể `http://localhost:3000`. Client Tide chỉ bootstrap origin 5173; nếu chọn 3000, cần cập nhật redirect/origin và ký lại cài đặt tại Tide, rồi xuất lại adapter. Đừng hiểu CORS cho phép là Tide tự cho phép. Callback `/auth/redirect` cần xử lý lỗi theo SDK, relay lấy từ `public/tide_dpop_auth.html` phải giữ nguyên byte. Frontend host cần rewrite `/tide_dpop/*` đến file này, header `Allow-CSP-From: *`, CSP riêng `default-src 'self'; script-src 'unsafe-inline'`, không `X-Frame-Options` hoặc `frame-ancestors` trên relay. Backend có relay riêng để kiểm thử giao thức; nó không thay relay của frontend origin.

## Nhận dạng và onboarding

`GET /v1/me` trả `onboardingRequired:true` nếu danh tính Tide chưa có account local. Người bệnh có role `careflow-patient` tạo profile qua `POST /v1/me/onboarding` với `displayName`, `clinicId`; phone/email/dateOfBirth tùy chọn. Không hỏi mật khẩu Tide. Nhân viên dùng liên kết thủ công qua CLI theo `(iss,sub)`, không liên kết theo email/số điện thoại.

`PATCH /v1/me` nhận một hoặc nhiều trường `displayName`, `phone`, `email`. Vai trò đến từ token Tide và không sửa qua API này. Nhóm tự làm UI quyết định cách trình bày thông tin tùy chọn; chưa có form frontend hay logo được tạo tự động.

## Luồng đặt, đổi và tái khám

1. `GET /v1/clinics`, `/v1/services`, `/v1/doctors?serviceId=<id>`.
2. `GET /v1/availability?serviceId=<id>&from=2026-10-23&to=2026-10-25&after=08:00&before=12:00`, doctorId tùy chọn. Các ngày hiểu theo `Asia/Ho_Chi_Minh`, response thời điểm UTC.
3. Người bệnh xác nhận dịch vụ, bác sĩ, giờ, giá tham khảo và địa điểm rồi mới POST.

Ví dụ body `POST /v1/appointments`, header `Idempotency-Key: <UUID-mới>`:

```json
{
  "doctorId": "40000000-0000-4000-8000-000000000001",
  "serviceId": "50000000-0000-4000-8000-000000000001",
  "startsAt": "2026-10-23T09:00:00+07:00"
}
```

Response 201 có `id`, `startsAt`, `endsAt`, `doctorName`, `serviceName`, `clinic`, `status:CONFIRMED`, `version:1`. Đừng lấy giờ ví dụ làm slot còn trống: luôn lấy availability mới. SlotId chỉ để hiển thị; server xác minh lại doctor/service/time. Giá không phải thanh toán.

`GET /v1/appointments` trả `{items,limit,offset}` theo quyền. Muốn đổi, POST `.../:id/reschedule` body `{doctorId, startsAt, expectedVersion}` với key mới. Hủy và attendance-confirmation dùng `{expectedVersion}`. `409 SLOT_UNAVAILABLE` tải lại slot; `409 VERSION_CONFLICT` tải lại appointment; retry request bị timeout phải dùng lại key/body cũ. Một key với body khác nhận `409 IDEMPOTENCY_MISMATCH`.

Trạng thái lượt khám: `CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED`; `CANCELLED` trước check-in, `NO_SHOW` do nhân viên đánh dấu sau giờ hẹn. `ATTENDING` là xác nhận sẽ đến, không phải check-in. `ACTION_REQUIRED` báo lịch bị ảnh hưởng: hiển thị lý do vận hành, tải `.../:id/alternatives`, cho người bệnh tự chọn hoặc hủy. Server không tự chuyển lịch.

`GET /v1/me/visits` và `.../:id` chỉ hiển thị tài liệu RELEASED cho người bệnh. `GET /v1/me/follow-ups` trả service, khoảng ngày và `preferredDoctorId`; booking mới kèm `followUpId`, vẫn cần người bệnh chọn giờ/xác nhận. Không tự đưa ra chỉ định tái khám.

## Hồ sơ E2EE và quyền Tide

Backend không nhận plaintext, không có endpoint giải mã. `title` chỉ nên là nhãn trung tính; chẩn đoán/lời dặn nằm trong ciphertext. Luồng tạo:

1. Tác giả hợp lệ POST `/v1/records/drafts` với appointmentId/title/kind để giữ UUID. Với tài liệu đã mã hóa, POST `/v1/records` dùng recordId do client tạo.
2. Admin lấy `/v1/records/:id/policy-context` để biết public key đã xác minh của bệnh nhân và đường dẫn care-group theo đúng record. Bệnh nhân cần đăng nhập ít nhất một lần để server ghi nhận tideuserkey từ token đã xác minh.
3. Từng admin dùng tài khoản Tide của mình để ký policy `RelationshipAttestation:1`; không gửi mật khẩu hoặc chữ ký riêng cho backend. User policy phải dành cho tideuserkey của bệnh nhân, Group policy phải dành cho `/careflow/<clinicId>/records/<recordId>/care-team`. App role admin không tự cho phép giải mã.
4. Import bytes qua `PUT /v1/records/:id/policy` body `{subjectType,subjectId,policyBytes}`. API kiểm tra định dạng/contract/vendor/record/subject/model/expiry và có trường signature; **không chứng minh chữ ký hợp lệ hoặc quorum đạt**. Response `grantsAccess:false`, trạng thái mật mã chưa xác minh.
5. Browser dùng helper chính thức `relationship-attestation` của Tide để mã hóa với policy đã ký, tags **duy nhất `[recordId]`**. Upload base64 qua PUT `.../:id/content` kèm `encryptionScheme:TIDE_RELATIONSHIP_ATTESTATION_V1`, tags và expectedVersion.
6. Tác giả công bố bằng POST `.../:id/release`. Cần ciphertext và User policy đúng bệnh nhân. RELEASED là gate nghiệp vụ, không phải bằng chứng mật mã. Nội dung đã công bố không sửa tại chỗ; tạo tài liệu bổ sung.
7. Người có quyền API lấy ciphertext và GET `.../:id/policy`. Backend chỉ trả User policy đúng tideuserkey hoặc Group policy có subjectId nằm trong groups claim đã xác minh; quyền giải mã thực tế vẫn do Tide quyết định.

Mỗi policy User/Group phải mở được cùng ciphertext đúng phạm vi trên mạng thật trước khi coi E2EE hoàn tất. Chính sách sai/tampered phải bị Tide từ chối. Việc trả được ciphertext không đồng nghĩa đọc được bệnh án.

Người bệnh POST `/v1/records/:id/access-requests` với doctorId/intent (`GRANT` hoặc `REVOKE`). Đây chỉ là ý định `PENDING_TIDE`, không có endpoint approve giả. `GET /v1/me/sharing` trả tham chiếu và `effectivePermissions:UNVERIFIED`; UI không được hiển thị “đã cấp quyền” chỉ vì lưu ý định hoặc policy. Quản trị thực tế và kiểm tra hiệu lực thực hiện trực tiếp ở Tide. Thu hồi cần commit rồi refresh credential/token; không thu hồi plaintext đã tải.

## Phần bổ sung miễn phí

`GET /v1/me/notifications` trả thông báo của mình, `deliveryStatus:SIMULATED`. PATCH `.../:id/read` đánh dấu đọc. Worker xử lý outbox mỗi 30 giây, loại nhắc cũ sau thay đổi. Không có email/SMS thật.

P1: POST `/v1/me/dependents` tạo yêu cầu, nhân viên chỉ verify sau khi kiểm tra ủy quyền ngoài hệ thống. Chỉ VERIFIED mới đặt hộ được; không cấp quyền bệnh án. POST `/v1/appointments/:id/check-in-code` trả chuỗi ký có hạn 10 phút để frontend render QR; nhân viên POST `/v1/check-ins/scan` để tiêu thụ một lần.

`POST /v1/assistant/messages` nhận intent giới hạn `availability`, `appointments`, `faq`. Đây là rules API có nút gợi ý, không hiểu văn bản tự do. Không có LLM, phí API, đọc bệnh án, chẩn đoán hoặc tự đặt lịch. Response slot vẫn phải được người bệnh xác nhận qua API booking riêng.

Lỗi chuẩn `{code,message,requestId}`; input sai có thể thêm `fields`. Không log token, proof, mật khẩu, ciphertext hay plaintext trong console/frontend telemetry.
