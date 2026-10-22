# Kết quả kiểm chứng — 22/10/2026, Asia/Ho_Chi_Minh

## Backend đã chạy và đã kiểm thử

- `npm test`: **10 nhóm kiểm thử, 10 pass, 0 fail** trên Node 24.
- `npm run format:check`: pass. TypeScript strict build và export `docs/openapi.json`: pass.
- `npm audit` lúc cài dependency cuối: 0 vulnerabilities được báo cáo; đây không phải chứng nhận an toàn toàn hệ thống.
- `docker compose build api`: pass. `docker compose up -d --no-build`: pass. Container `careflow-api-1` healthy; seed thật trong volume Docker đã tạo thành công.
- Windows truy cập localhost:3333: `/health/live`, `/docs`, `/v1/services` trả 200; `/health/ready`, `/v1/me` trả **503 TIDE_NOT_CONFIGURED** đúng với trạng thái chưa có adapter.
- Milvus CLI: `DISABLED`; không có collection hoặc nghiệp vụ vector. SQLite là transaction store thực tế.

| Nhóm kiểm thử | Bằng chứng được kiểm tra |
| --- | --- |
| Booking/đổi/hủy | Hai HTTP request cùng slot: 201/409; retry cùng key cùng ID; key dùng lại body khác 409; slot bị chiếm làm đổi lịch thất bại và giữ nguyên booking cũ; chống chồng lịch bệnh nhân giữa hai bác sĩ; optimistic version |
| Phân quyền | Bệnh nhân khác/không cùng phân công không xem được; thiếu clinic membership bị chặn; role của client lạ không cấp admin; bác sĩ đồng thời có role patient không hủy lịch bệnh nhân khác nhờ role mặc định; reception/admin không đọc bệnh án chỉ nhờ role đó; PATCH không tự đổi role; onboarding không tạo trùng và lưu public key đã xác minh |
| JWT/DPoP | Sai issuer/client/audience/expiry bị từ chối; Bearer hoặc thiếu proof bị chặn; sai URL/method/iat/ath/key binding bị chặn; proof phát lại bị chặn; không tin forwarded host giả; query không làm sai htu |
| Bác sĩ nghỉ | Chặn booking mới, giữ nguyên lịch cần xử lý để bệnh nhân tự chọn; vô hiệu hóa nhắc cũ, thông báo `SIMULATED`; reschedule hợp lệ giải quyết disruption |
| Record/policy | DRAFT không lộ cho bệnh nhân; release cần ciphertext và policy bệnh nhân; sau RELEASED không sửa nội dung; sai record trong policy bị từ chối; import không tự grant; bác sĩ mới được phân công lấy được ciphertext RELEASED nhưng không được coi là đã giải mã; không có endpoint approve giả |
| Tái khám | Đúng chủ sở hữu, service, khoảng ngày và liên kết lần trước; không tạo hai booking hiệu lực từ cùng đề nghị |
| Người thân | PENDING không đặt hộ được; chỉ sau nhân viên verify mới đặt hộ; response luôn nêu không cấp quyền bệnh án |
| Check-in | Mã ký dùng một lần; reception check-in; bác sĩ đúng phân công bắt đầu/hoàn tất; đã check-in không hủy kiểu CONFIRMED |
| Hai writer/persistence | Hai Worker Thread có connection SQLite độc lập cùng bắt đầu tranh một slot: chỉ một thành công; mở lại connection vẫn giữ idempotency và chặn replay JTI |
| Contract/public/input | Bộ lọc catalog/slot, OpenAPI schemas/DPoP header, relay byte-exact và CSP, CORS chỉ origin chỉ định, lỗi JSON/schema có requestId, PATCH giữ trường không sửa |

Các test dùng key/adapter sinh tạm và ciphertext/signature fixture **không hợp lệ trên mạng Tide** để kiểm thử API boundary/serialization. Chúng không chứng minh login, E2EE hoặc quorum Tide thật; không có fixture hoặc chế độ bỏ auth được nạp trong app chạy thật.

## Trạng thái Tide thật

Docker image `tideorg/tidecloak-dev:latest` đã tải và chạy. Digest đã dùng: `sha256:3f52d0bc3e4e3ae5153e172960003bbe94705cd40af6561fd4c7c4434aaa2708`. Realm `careflow` và client `careflow-client` đã tạo; public discovery trả 200.

Email licence và đồng ý điều khoản đã được chính người dùng cung cấp, lưu trong `.env`, không cần hỏi lại. Không có thanh toán được kích hoạt.

Lần cấp licence đầu qua `POST /admin/realms/careflow/vendorResources/setUpTideRealm` trả HTTP 500, code `TIDE-IDPEXT-VENDOR-KEYGEN_FAILED`. Log phía container: `[Midgard] FinalizeWallet failed ... 500 (Internal Server Error)`. Bản thân thông báo nói vendor key đã tạo nhưng licence chưa setup được. Script dừng trước IGA và enrolment.

Lần retry trả HTTP 500 `TIDE-IDPEXT-VENDOR-REALM_SETUP_FAILED`, log có `ModelDuplicateException`/duplicate IdP alias `tide` trong realm hiện tại. Đây là setup dở dang, không thể coi endpoint setup là idempotent. Không xóa realm hoặc volume để che lỗi; không force-rotate key/đi qua checkout. Cần xử lý lỗi licence/IdP dở dang theo hướng dẫn Tide trước khi tiếp tục. Tài nguyên vẫn được giữ để kiểm tra. Endpoint license details có lúc trả 200 nhưng không phải bằng chứng licence hợp lệ, và không thay thế gate bootstrap thành công.

IGA hiện **false**, `iga.attestor` chưa cấu hình. Chưa tạo/enrol admin Tide hoặc xuất `data/tidecloak.json`. Chưa có admin policy ký với quorum >=2. Backend không tự kích hoạt quyền bằng số phiếu trong database.

Tide Doctor đã chạy lại trên backend Docker đang phục vụ URL thật:

```text
9 passed, 0 fixed, 2 warning(s), 1 failure(s)
FAIL: no adapter JSON found
WARN: useDPoP client configuration absent (frontend excluded)
WARN: IGA not enabled
PASS: relay HTTP 200, byte-exact, Allow-CSP-From, script-src CSP
PASS: realm exists, no pending change requests, .env ignored, no hardcoded master password
```

Doctor chưa đạt `RESULT: OK`. Bộ phát hiện API của Doctor không nhận dạng NestJS layout này; kiểm chứng global guard/authorization dựa vào integration tests riêng, không dựa vào dòng “no API routes found”. Cấu hình SDK client phải làm trong repo frontend của nhóm.

## Gate còn phải vượt trước khi nộp demo bảo mật

1. Khôi phục licence hợp lệ, bật IGA Tide đúng một lần, hoàn tất first-admin enrollment và xuất adapter thật. Chọn branding/onboarding với chủ app; chưa tạo UI trong repo này.
2. Ba người tự enrol tài khoản admin độc lập. Không lưu credential/quyền ký của họ vào backend; kiểm tra signed policy quản trị thực tế yêu cầu ít nhất hai chữ ký.
3. Login thật và gọi API bằng DPoP; browser mã hóa/giải mã cùng một record qua User policy của bệnh nhân và Group policy của care-team.
4. Một admin không thể tự thêm mình/bác sĩ vào nhóm, đổi threshold, đổi signed policy, sửa roles hoặc ký policy thay thế để vượt quyền. Hai admin độc lập đủ ngưỡng mới commit và giải mã sau refresh.
5. Chính sách sai tag/hai tags, chủ thể khác/không thuộc nhóm, ciphertext/policy bị sửa đều bị Tide từ chối. Sửa metadata/database ứng dụng không làm network chấp nhận credential/policy không hợp lệ.
6. Thu hồi sau commit và refresh bị chặn đúng phạm vi. Không tuyên bố thu hồi plaintext đã tải. Chỉ sau các phép thử này mới đánh dấu tích hợp Tide đạt và quay video.

Các mục trên **chưa chạy**, không được suy ra từ tests local hoặc từ tài liệu của nhà cung cấp. Repo đích: [RMIT_SGS_sTEAM_C2](https://github.com/ewtherka/RMIT_SGS_sTEAM_C2); chưa ghi video.
