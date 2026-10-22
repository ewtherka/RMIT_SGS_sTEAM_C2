## CareFlow — bản demo

Tải **CareFlow-demo.zip** trong mục **Assets** bên dưới, giải nén toàn bộ rồi chạy **START-DEMO.cmd** trên Windows. Cần **Node.js 24+**; lần đầu cần Internet để cài thư viện backend. Mở **http://localhost:5173** và giữ cửa sổ lệnh mở trong lúc dùng.

macOS/Linux: `node scripts/start-demo.mjs --no-open`, sau đó mở địa chỉ trên. Đây là **web app chạy cục bộ**, không phải file `.exe` độc lập và không tự tạo website công khai.

### Có trong bản này

- Tìm bác sĩ, đặt lịch, đổi/hủy lịch và xác nhận tham dự.
- Hồ sơ sức khỏe, chia sẻ/thu hồi từng hồ sơ với 2 admin độc lập và lịch sử truy cập.
- Truy cập khẩn cấp: lý do, 2 phiếu độc lập, thời hạn 60 phút, bệnh nhân có thể kết thúc ngay.
- Tên bác sĩ và các nhãn demo đã được làm gọn; thông báo **Mô phỏng TideCloak** được giữ nguyên.

Frontend và backend đã build sẵn trong ZIP. Không chứa database, token, thông tin đăng nhập hoặc dữ liệu bệnh nhân thật. Mỗi thư mục giải nén mới tạo database mô phỏng riêng. Không nhập dữ liệu y tế thật.

**Kiểm chứng:** build thành công; 12 unit test, 15 kịch bản trình duyệt chính, 4 kịch bản khẩn cấp và kiểm tra nhãn hiển thị đã qua. Bundle đã chạy độc lập trên Linux; Windows launcher chưa được A xác nhận trực tiếp.

**Giới hạn:** TideCloak sign-in, roles, access checks và quorum đang được mô phỏng tại backend. Không phải live Tide E2EE hoặc quorum mật mã thật.

[Kịch bản quay demo](https://github.com/ewtherka/RMIT_SGS_sTEAM_C2/blob/main/DEMO.md). Kiểm tra tính toàn vẹn bằng file **CareFlow-demo.sha256** đính kèm, chạy `sha256sum -c CareFlow-demo.sha256` trong cùng thư mục với ZIP.
