# CareFlow — trao đổi Agent A (Front-end) ↔ Agent B (Back-end)

File này là kênh phối hợp theo yêu cầu của người dùng. Mỗi agent thêm phản hồi dưới tên của mình; giữ lại các quyết định trước đó và đánh dấu rõ đề xuất / đã thống nhất / đã triển khai. Không ghi token, mật khẩu hoặc dữ liệu bệnh nhân thật.

## 2026-10-22 — Agent A: ĐANG DỪNG CODE, cần chốt kế hoạch theo backend thực tế

Chào B! Người dùng yêu cầu mình gửi lời nhắn lên Git và dừng build front-end cho tới khi có kế hoạch cụ thể. Mình đã dừng. Code giao diện hiện chỉ là bản nháp local, chưa kiểm thử và chưa đưa lên Git. Commit trao đổi này chỉ chứa `agentdialogue.md`.

Mình vừa fetch `main` tại commit `e51aa00` và đã đọc `careflow-backend/docs/FRONTEND.md` cùng `careflow-backend/src/contract.ts`. Backend của bạn đã có contract chi tiết; mình sẽ lấy contract thực tế làm chuẩn, **không dùng API giả định trong lời chào cũ phía dưới**.

### Những điểm A đã nắm từ tài liệu của B

- Backend tại `http://localhost:3333`, prefix `/v1`; frontend origin dự kiến `http://localhost:5173`.
- Catalog công khai: clinics/services/doctors; lịch trống qua `/v1/availability`. Đặt lịch dùng `serviceId`, `doctorId`, `startsAt`; không dùng cặp `date`/`time` giả định.
- Cần `Idempotency-Key`, xử lý `expectedVersion`, `SLOT_UNAVAILABLE`, `VERSION_CONFLICT`; trạng thái lịch là enum viết hoa. Response không có envelope `{data}` như đề xuất cũ; lỗi `{code,message,requestId}`.
- Auth dùng Tide và DPoP strict, `secureFetch` ký đúng URL backend tuyệt đối. `/v1/auth/config` có thể chưa configured; phải hiển thị trạng thái setup thật, không tạo mock token.
- Tài liệu nhắc SDK React, callback `/auth/redirect` và relay `/tide_dpop/*` có yêu cầu host riêng. Chưa chốt stack frontend cho bản tích hợp.
- Hồ sơ dùng ciphertext và quy trình policy/release. Request GRANT/REVOKE chỉ trả `PENDING_TIDE`, quyền thực tế `UNVERIFIED`; UI không được biến nó thành “đã cấp/thu hồi quyền”.
- Bản nháp local của A đang có logic mô phỏng bằng localStorage; phần đó không phải thiết kế tích hợp đã thống nhất và sẽ cần thay theo contract thật.

### B vui lòng trả lời để A lập kế hoạch frontend chính xác

1. **Bản đang chạy / nguồn chuẩn:** `FRONTEND.md` và snapshot `openapi.json` trên main có phải contract mới nhất không? Endpoint/schema nào đang thay đổi hoặc chưa hoạt động? Backend hiện chạy được ở đâu, bằng lệnh nào, health endpoint nào? Nếu có bước setup còn thiếu, chỉ ghi tên biến/binding, không ghi secret.
2. **Phạm vi MVP:** với khả năng backend hiện có, chốt màn hình và luồng bắt buộc cho bệnh nhân/bác sĩ là gì? Có cần reception/admin/policy signing trong vòng demo này không, hay để ngoài phạm vi? Luồng nào phải có để trình diễn cuộc thi, luồng nào tạm hoãn?
3. **Auth và framework:** B đề xuất chính xác package/version SDK Tide nào, provider và `secureFetch` API nào đã kiểm chứng? Có sample browser login chạy được chưa? Có đồng ý frontend React để dùng SDK chính thức không? Chốt origin 5173, callback, logout, khôi phục phiên và nguồn role từ `/v1/me`/token giúp mình.
4. **Dữ liệu giao diện:** seed `clinicId/serviceId/doctorId` nào dùng được, availability được tạo cho khoảng ngày nào? Có payload thực tế cho `/v1/me`, catalog, availability, appointments, visits và notifications không? Trường hiển thị bác sĩ/phòng khám nào thực sự có? A sẽ không tự bịa rating, kinh nghiệm, phòng hoặc phí khám.
5. **Booking:** xác nhận các action backend hỗ trợ trong MVP: create, reschedule, cancel, attendance-confirmation, check-in. A có thể map enabled/disabled action theo status/version nào? Appointment đã CHECKED_IN hoặc ACTION_REQUIRED cần UI và hành vi gì? Những điều đã rõ trong tài liệu A sẽ tuân theo; xin chỉ ra ngoại lệ hoặc phần chưa triển khai.
6. **Hồ sơ và chia sẻ:** Tide/E2EE đã được kiểm thử trên mạng thật đến bước nào? Frontend phải thực hiện giải mã/ký/mã hóa qua API SDK cụ thể nào? Trong thời gian chưa xác minh mật mã, thống nhất UI chỉ hiển thị metadata/trạng thái chờ nào? Bác sĩ được thấy metadata của hồ sơ chưa được chia sẻ đến mức nào? Ai thực hiện thao tác policy/quorum cho demo?
7. **Kết nối và nghiệm thu:** chốt CORS, relay hosting, env public của frontend và cách chạy hai service cùng nhau. B cung cấp tài khoản/fixture bằng luồng an toàn nào để test bệnh nhân + bác sĩ được quyền + bác sĩ bị từ chối? Mình cần test luồng thực tế, không hardcode quyền hay giả lập đăng nhập thành công.

### Bước tiếp theo — CHƯA THỐNG NHẤT

B phản hồi ngay trong file này, ghi rõ phần đã có / còn thiếu. Sau đó A và B chốt một mục “Kế hoạch đã thống nhất” gồm: phạm vi MVP, stack, bảng màn hình ↔ endpoint, schema/trạng thái, luồng Tide, quyền sở hữu file, thứ tự triển khai và các bài kiểm thử nghiệm thu. **A dừng chỉnh code frontend cho tới khi có kế hoạch cụ thể.** Không coi im lặng là đồng ý với đề xuất.

---

## Lịch sử — lời chào/đề xuất ban đầu của A (ĐÃ THAY THẾ, không dùng làm contract)

Chào B! Mình là agent A, phụ trách front-end CareFlow. Người dùng yêu cầu xây một working app và hai bên phối hợp qua file này. Mình đang làm trên checkout `/workspace/RMIT_SGS_sTEAM_C2`, không tạo thêm worktree.

### Mục tiêu demo chung

1. Bệnh nhân tìm bác sĩ → chọn ngày/giờ → đặt lịch → xem, đổi hoặc hủy lịch hẹn.
2. Bệnh nhân xem hồ sơ mẫu, cấp/thu hồi quyền xem cho từng bác sĩ.
3. Bác sĩ xem lịch của mình, mở hồ sơ được cấp quyền; API từ chối truy cập khi không có quyền.
4. Tích hợp Tide theo khả năng thực tế. Chỉ công bố xác thực/mã hóa nào đã được triển khai và kiểm chứng.

### Trạng thái và phân chia công việc — đề xuất

- A đang xây giao diện responsive tiếng Việt bằng HTML/CSS/JavaScript module, không có dependency runtime. Dữ liệu hiện là demo trong localStorage, được ghi nhãn rõ. Các màn hình: tổng quan, bác sĩ, lịch hẹn, hồ sơ, quyền riêng tư, thông tin cá nhân, cổng bác sĩ.
- A phụ trách `index.html`, `src/`, `public/`, `server.mjs`, `scripts/`, test front-end và README front-end. Các file này đang được tạo, vui lòng tránh sửa đè.
- B vui lòng dùng thư mục `backend/` và tài liệu/test của backend để tránh xung đột. Nếu đã có code hoặc lựa chọn khác, hãy ghi lại vị trí và stack; mình sẽ thích nghi.
- Các file gốc dùng chung (`package.json`, `.gitignore`, cấu hình chạy chung) cần phối hợp trước khi hai bên sửa. Hiện có npm scripts `dev`, `build`, `test`, `test:e2e` cho front-end.
- Mỗi bên giữ công việc độc lập chạy được; sau khi B có API ổn định, A nối thông qua lớp adapter riêng. Mình sẽ kiểm tra lại file này khi hoàn thành các bước giao diện/kiểm thử.

### API v1 tối thiểu — ĐỀ XUẤT, chưa coi là đã thống nhất

Prefix đề xuất: `/api/v1`. JSON response thành công: `{ "data": ... }`; lỗi: `{ "error": { "code": "...", "message": "..." } }`.

| API | Mục đích / dữ liệu chính |
| --- | --- |
| `GET /me` | Danh tính đã xác thực, `id`, `role`, thông tin hồ sơ; backend quyết định vai trò. |
| `GET /doctors?specialty=&q=` | `id`, `name`, `title`, `specialty`, `room`, `fee` (số nguyên VND); `rating`, `reviews`, `experience` là tùy chọn. |
| `GET /doctors/:id/slots?date=YYYY-MM-DD` | Danh sách `{ time: "09:30", available: true }`, múi giờ `Asia/Ho_Chi_Minh`. |
| `GET /appointments` | Lịch của bệnh nhân hiện tại, hoặc lịch thuộc bác sĩ hiện tại; không trả lịch người khác. |
| `POST /appointments` | Body `{ doctorId, date, time, reason }`; trả `id`, các trường lịch hẹn và `status`. |
| `PATCH /appointments/:id` | Đổi lịch: `{ date, time, reason }`, có thể thêm `doctorId` nếu hỗ trợ đổi bác sĩ. |
| `POST /appointments/:id/cancel` | Hủy lịch; cần kiểm tra chủ sở hữu và trạng thái. |
| `GET /records` | Danh sách hồ sơ thuộc bệnh nhân, hoặc metadata được phép hiển thị cho bác sĩ. |
| `GET /records/:id` | Nội dung chỉ trả khi có quyền; bác sĩ chưa có quyền nhận `403`. |
| `PUT /records/:id/access/:doctorId` | Bệnh nhân sở hữu cấp quyền cho một bác sĩ. |
| `DELETE /records/:id/access/:doctorId` | Bệnh nhân sở hữu thu hồi quyền; kiểm tra lại tại API khi truy cập tiếp theo. |

Quy ước đề xuất: ngày `YYYY-MM-DD`, giờ `HH:mm`, trạng thái lịch `confirmed | completed | cancelled`. Trùng slot hoặc xung đột lịch trả `409`; thiếu xác thực `401`; thiếu quyền `403`; validation `422`. Backend xác minh slot và quyền độc lập với UI. Việc đặt lịch không tự cấp quyền xem mọi hồ sơ. Chuyển vai trò trong giao diện hiện tại chỉ là demo, không được dùng làm căn cứ xác thực thật.

### Nhờ B phản hồi tại đây

1. Backend hiện có gì, dùng stack nào, nằm ở đâu và chạy bằng lệnh nào?
2. Bạn đồng ý API trên hay đã có contract khác? Ghi schema/endpoint thực tế để A nối đúng.
3. Tide đã tích hợp đến bước nào? Luồng đăng nhập, session/cookie/token và CORS/CSRF dự định ra sao? Không gửi secret.
4. Base URL/port local, endpoint kiểm tra sức khỏe và dữ liệu seed dùng để kiểm thử là gì?

Lời chào ban đầu này được giữ làm lịch sử. Trạng thái hiện tại: A đã dừng build theo yêu cầu người dùng; xem mục cập nhật đầu file.
