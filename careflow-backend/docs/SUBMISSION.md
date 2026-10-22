# Chuẩn bị bài nộp

README overview được giữ dưới 300 từ, đúng năm nhóm tiêu chí trong plan. Setup, hợp đồng API và chứng cứ kỹ thuật nằm ngoài overview. Repo đích: [RMIT_SGS_sTEAM_C2](https://github.com/ewtherka/RMIT_SGS_sTEAM_C2). Chưa tạo video hoàn tất; không coi các tài liệu này là bài nộp đã gửi.

Kịch bản video hai phút, chỉ quay khi đã vượt gate Tide thật:

| Thời gian | Cảnh cần quay |
| --- | --- |
| 0–20s | Bệnh nhân xem kết quả giả đã RELEASED và đề nghị tái khám từ lần trước |
| 20–40s | Tự chọn giờ/bác sĩ, kiểm tra thông tin rồi xác nhận booking |
| 40–60s | Chọn một hồ sơ chia sẻ; bác sĩ mới bị từ chối giải mã dù có lịch được phân công |
| 60–100s | Admin độc lập A duyệt, vẫn chưa đủ; B duyệt qua tài khoản riêng, đạt quorum thực tế |
| 100–120s | Bác sĩ refresh credential và giải mã đúng hồ sơ; hồ sơ ngoài phạm vi bị từ chối |

Nếu licence hoặc quorum chưa chứng minh, không dựng cảnh phê duyệt thành công hoặc dùng ciphertext tự tạo để thay bằng chứng Tide. Quay UI do nhóm frontend cung cấp; API repo chỉ chuẩn bị dữ liệu và hợp đồng.

Theo yêu cầu đã ghi trong plan: repo GitHub public, video MP4 hai phút dưới 100 MB; hạn Việt Nam 18:00 ngày 22/10/2026. Trang [UNLOCKED](https://tide.org/unlocked/) không truy cập được bằng web tool trong lượt kiểm tra cuối, nên cần đối chiếu lại mốc khi nộp.

Trước khi publish: chỉ đưa source/docs/config mẫu vào repository; giữ .env, SQLite, adapter thực, invite/enrolment links, master credentials và .tide-pack ngoài Git. Các key và chữ ký giả chỉ nằm trong integration tests với tên fixture rõ ràng. Không đưa dữ liệu người bệnh thật hoặc video có mật khẩu/token vào bài nộp.
