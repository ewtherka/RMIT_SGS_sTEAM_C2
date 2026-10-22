# CareFlow — bản quay demo

## Chạy nhanh trên Windows

1. Cài **Node.js 24 trở lên** từ https://nodejs.org nếu chưa có.
2. Tải `releases/CareFlow-demo.zip` từ GitHub, giải nén toàn bộ vào một thư mục.
3. Nhấp đúp **START-DEMO.cmd**. Lần đầu cần Internet để cài thư viện backend; không cần Docker hay cấu hình Tide thật.
4. Mở **http://localhost:5173**, giữ cửa sổ lệnh mở trong lúc quay. API/Swagger: http://localhost:3333/docs.

Trong bản ZIP, giao diện và backend đã build sẵn. Đây là **web app chạy cục bộ**, không phải file `.exe` độc lập. Không có mật khẩu, token, dữ liệu bệnh nhân thật hoặc database cũ trong gói. Database giả được tạo trên máy người chạy. Đừng nhập dữ liệu y tế thật.

Nếu dùng source GitHub: `git pull --rebase origin main`, sau đó chạy `START-DEMO.cmd` hoặc `node scripts/start-demo.mjs`. Source sẽ được build trước khi chạy. Hai dịch vụ CareFlow đang chạy đúng cổng sẽ được giữ nguyên; launcher không tự tắt tiến trình của bạn. Khi dùng app cũ đang chạy, hãy tự dừng/restart để nhận code mới. Gặp cổng bị app khác chiếm, launcher báo lỗi thay vì kill app đó.

macOS/Linux: chạy `node scripts/start-demo.mjs --no-open`, rồi mở URL trên. Lần đầu cần Internet; sau khi đã cài thư viện, ứng dụng không tải font hay dữ liệu từ dịch vụ ngoài.

## Kịch bản quay 2–3 phút

Chuyển tài khoản bằng banner **MÔ PHỎNG** ở đầu trang. Refresh trang sẽ đăng xuất, đây là chủ đích: token chỉ nằm trong bộ nhớ.

1. **Nguyễn An**: tìm **BS. Lan**, chọn lịch trống và xác nhận đặt lịch. Lịch khám tạo quan hệ chăm sóc, **không** tự cấp quyền đọc hồ sơ.
2. Đổi sang **BS. Lan** → Hồ sơ → **Kết quả mẫu** → **Kiểm tra và mở hồ sơ**. Máy chủ trả từ chối; không có nội dung hiện ra.
3. **Nguyễn An** → **Quyền riêng tư** → thẻ **Kết quả mẫu** → **Gửi yêu cầu**. Chọn BS. Lan và chia sẻ.
4. **Admin độc lập 1** → phê duyệt. Quorum **1/2**: Lan vẫn bị từ chối. Admin 1 không thể tự bỏ phiếu lần hai.
5. **Admin độc lập 2** → phê duyệt. Quorum **2/2**: Lan mở được **đúng hồ sơ này**; **Lời dặn mẫu** vẫn không được mở.
6. **Nguyễn An** → Quyền riêng tư → **Xem lịch sử truy cập**. Có các lần bị từ chối, phiếu phê duyệt và lần đọc thành công. Có thể gửi yêu cầu thu hồi và lặp lại 2 admin để chặn lần đọc tiếp theo.

### Cảnh phụ: khẩn cấp, không có “master key”

Sau khi thu hồi quyền chia sẻ bằng 2 admin, giữ lịch BS. Lan đang hiệu lực:

BS. Lan mở hồ sơ → **Yêu cầu truy cập khẩn cấp**, nhập lý do giả ≥10 ký tự → 2 admin độc lập phê duyệt → quyền đọc **60 phút**, chỉ một hồ sơ → Nguyễn An thấy lý do và hạn truy cập trong Quyền riêng tư → **Kết thúc ngay** → Lan bị chặn lại. Một phiếu chưa đủ; admin không tự được quyền đọc.

## Giới hạn phải nói rõ

TideCloak sign-in, roles, access checks và quorum hiện được **mô phỏng ở API**, đúng yêu cầu prototype. Quyền không được tự cấp ở frontend. Backend giữ khóa AES và kiểm tra quorum bằng SQLite; **không phải Tide E2EE hoặc quorum mật mã thật**. Strict mode có adapter SDK chính thức nhưng còn cần xác thực Tide thực tế. Không quảng cáo đây là sản phẩm y tế production.

Launcher không reset DB. Nếu đã quay/thử trước đó, dùng thư mục giải nén mới để có trạng thái giả sạch; không xóa database đang cần dùng. Quá trình test tạo audit entry nên không chạy test trên database chuẩn bị quay.
