# Chạy CareFlow backend

Yêu cầu: Node.js 24+, npm; Docker chỉ cần cho Tide và bản chạy container. Không cần API key LLM, tài khoản trả phí, PostgreSQL hoặc Prisma. Frontend chưa được xây trong repo này.

## Chạy bằng Node trên Windows

```powershell
git clone https://github.com/ewtherka/RMIT_SGS_sTEAM_C2.git
cd RMIT_SGS_sTEAM_C2\careflow-backend
npm.cmd ci --ignore-scripts
# Máy mới: copy .env.example thành .env; không có bí mật hoặc tài khoản Tide trong Git.
# Chạy setup-local.mjs với email và sự đồng ý điều khoản của chính chủ licence (xem bên dưới).
npm.cmd run seed
npm.cmd start
```

Mở <http://localhost:3333/docs> hoặc <http://localhost:3333/openapi.json>. `GET /health/live` kiểm tra process. `GET /health/ready` trả 503 nếu chưa có Tide adapter thật. Catalog và slot vẫn xem được; API riêng tư trả `TIDE_NOT_CONFIGURED`. Không có đăng nhập giả hoặc chế độ bỏ kiểm tra token.

`npm.cmd run dev` biên dịch TypeScript và theo dõi thay đổi. `npm.cmd test` chạy integration tests bằng adapter/key tạm trong thư mục test; chúng không được dùng cho app thật. `npm.cmd run openapi` cập nhật hợp đồng API. `.env`, `.data/`, `data/tidecloak.json` và `.tide-pack/` được bỏ qua khi đưa vào Git/Docker.

## Chạy bằng Docker

Trên máy này, Docker Engine và Compose nằm trong Ubuntu WSL2. Giữ một terminal WSL mở trong lúc demo.

```bash
cd RMIT_SGS_sTEAM_C2/careflow-backend
docker compose up -d --build
docker compose exec api node dist/scripts/seed.js
docker compose ps
```

API bind localhost:3333, dữ liệu nằm trong named volume `careflow_careflow-app-data`. Container không nhận mật khẩu master admin hoặc email licence. Không chạy thêm API Node cùng cổng. Dùng `docker compose stop` để dừng và giữ dữ liệu. Không dùng `down -v` nếu cần giữ lịch hẹn.

## Tide local

Trước khi tạo realm trên máy mới, chính chủ licence phải đọc <https://tide.org/legal> rồi tự cung cấp email và sự đồng ý. `scripts/setup-local.mjs --license-email <email-thật> --accept-terms` chỉ dùng sau khi chủ licence đã đồng ý; script tạo bí mật ngẫu nhiên trong `.env` và không in mật khẩu.

```bash
bash scripts/init-tidecloak.sh
```

Script tạo realm `careflow`, public client `careflow-client`, callback frontend `http://localhost:5173/auth/redirect`, bật ràng buộc DPoP và chuẩn bị IGA Tide. Nó dừng nếu licence không cấp được, không chấp nhận `NEED_PAYMENT`/checkout. Không tạo thanh toán. Lúc có invite, từng người tự mở trình duyệt để liên kết Tide; backend không giữ tài khoản hay chữ ký của họ. Sau enrolment, script xuất adapter công khai vào `data/tidecloak.json`. Khởi động lại API để nạp adapter.

**Trạng thái máy hiện tại:** container `careflow-tidecloak` và realm đã tồn tại, nhưng licence thất bại và IGA chưa bật. Không chạy bootstrap mặc định để tạo lại. Lần retry đã phát hiện IdP `tide` được tạo một phần, gây `Duplicate resource error`; chỉ retry nguyên endpoint sẽ không sửa được. Giữ volume và dùng thông tin trong [VERIFICATION.md](VERIFICATION.md) khi xử lý với Tide. Không bật IGA hoặc tự tạo adapter để che lỗi licence.

## Gắn tài khoản demo với danh tính thật

`npm run seed` tạo một phòng khám, hai bác sĩ, một bệnh nhân, một lễ tân, ba placeholder admin độc lập, một lần khám đã hoàn tất và đề nghị tái khám. Hai record mẫu là DRAFT chưa có ciphertext: phải mã hóa bằng phiên browser thật rồi upload. Không có ciphertext hoặc tài khoản Tide giả trong seed.

Tài khoản local chưa liên kết không đăng nhập được. Sau khi người thật tự enrol và vai trò được Tide commit, lấy `sub` từ danh tính đã xác minh trên Tide Console rồi chạy:

```powershell
npm.cmd run link-user -- --local-user 30000000-0000-4000-8000-000000000002 --subject <sub-cua-bac-si-Minh>
```

Lệnh chỉ gắn `(issuer, subject)`; không cấp role hay quyền giải mã. `--unlink` gỡ liên kết. Trong Docker dùng `docker compose exec api node dist/scripts/link-user.js ...`, và adapter phải có thật.

| Người dùng giả | Local user ID kết thúc | App role phải được Tide cấp |
| --- | --- | --- |
| Bệnh nhân | `0001` | `careflow-patient` |
| BS. Minh / Lan | `0002` / `0003` | `careflow-doctor` |
| Lễ tân | `0004` | `careflow-receptionist` |
| Admin độc lập 1/2/3 | `0005` / `0006` / `0007` | `careflow-admin` |

Các ID đều có tiền tố `30000000-0000-4000-8000-00000000`. Xem ID đầy đủ trong `src/seed.ts`. Không gộp theo email/số điện thoại. Người bệnh mới có role hợp lệ có thể dùng `POST /v1/me/onboarding`; trường bắt buộc là `displayName`, `clinicId`, email/phone/ngày sinh tùy chọn.

`careflow-admin` không cấp `_tide_encryptor` hoặc `_tide_decryptor`. Các capability này phải được cấp đúng cho bệnh nhân/bác sĩ qua Tide. `tide-realm-admin` trên client `realm-management` là quyền quản trị Tide riêng; cần ba người độc lập, kiểm tra signed admin policy thực tế có ngưỡng >=2. Không cho backend tự duyệt hộ.

## Dữ liệu và giới hạn

SQLite WAL dùng transaction `BEGIN IMMEDIATE`, trigger chống chồng lấn bác sĩ/bệnh nhân và idempotency trong cùng transaction. Migration tự chạy theo `PRAGMA user_version` (hiện 3). Phù hợp demo một máy, không chạy shared SQLite qua NFS hoặc triển khai nhiều máy độc lập. Sao lưu bằng SQLite backup API hoặc dừng dịch vụ rồi sao lưu đầy đủ database/WAL; không chỉ copy file `.sqlite` đang ghi.

Milvus SDK và health-check có sẵn, mặc định tắt. `MILVUS_ADDRESS` chỉ dùng cho `npm run milvus:check`; chưa tạo collection và không tham gia giao dịch đặt lịch. Milvus yêu cầu vector field; không nhét vector giả từ ciphertext. [Schema chính thức](https://milvus.io/docs/schema.md).

Metadata liên hệ/lịch hẹn chưa E2EE. Giữ bản demo ở localhost và dùng dữ liệu giả. Mọi nội dung y khoa, lời dặn chi tiết nằm trong ciphertext; title nên là nhãn trung tính. Notifications có trạng thái `SIMULATED`; không có SMS/email gửi thật.
