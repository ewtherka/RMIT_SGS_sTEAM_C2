[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

# CareFlow

Webapp đặt lịch khám và quản lý quyền truy cập hồ sơ sức khỏe. Bản demo chạy frontend và backend trên máy của bạn; TideCloak đang được **mô phỏng**.

**[Tải bản demo mới nhất](https://github.com/ewtherka/RMIT_SGS_sTEAM_C2/releases/latest/download/CareFlow-demo.zip)** · [Trang Releases](https://github.com/ewtherka/RMIT_SGS_sTEAM_C2/releases) · [Hướng dẫn tải và chạy](#tải-và-chạy-webapp) · [Dependencies](#dependencies)

## Project overview

CareFlow lets patients book clinic visits and share one medical record at a time with a new doctor, while no single administrator, clinic or AI can unlock that record alone.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

A patient-centred clinic app where booking a doctor and reading records are separate powers. Each record's access is a governed decision, not a database flag.

### 2. Trust constraint insight

Today a clinic admin, or anyone with database access, can read every record. Patients therefore cannot share selectively, and clinics must trust every insider. When access needs the patient's request plus independent approvals, a stolen admin account or rogue insider can no longer open records.

### 3. Value & impact

Patients reschedule without calling reception and share only what a new doctor needs. Example: Nguyễn An books BS. Lan for a follow-up. Lan reads last week's result only after An shares it and two independent admins approve, never An's whole history.

### 4. Why TideCloak matters

TideCloak signs users in, and the server verifies the roles in its JWTs. Records are stored as ciphertext; policy and quorum-enforced governance decide who decrypts. CareFlow requires 2 of 3 independent admins to commit any access change, so authority emerges only when the patient's request and the quorum align. In this prototype, TideCloak's sign-in, roles and access checks are **simulated** (`TIDE_MODE=simulated`), as the brief permits. Strict mode verifies real TideCloak JWTs and DPoP proofs.

### 5. Prototype & storytelling

Key interaction:

1. BS. Lan has an appointment, yet is **denied** the record.
2. An shares that one record with her.
3. Admin 1 approves: still denied, and admin 1 cannot approve twice.
4. Admin 2 approves. Quorum is reached and Lan decrypts the record.

Booking, rescheduling and slot conflicts run on a NestJS API with synthetic data.

## Tải và chạy webapp

### 1. Cài phần mềm cần thiết

| Phần mềm | Yêu cầu | Cách cài |
| --- | --- | --- |
| Node.js | **24 trở lên**, bắt buộc | Tải bộ cài từ [nodejs.org](https://nodejs.org/). Node.js 24 có sẵn SQLite mà backend sử dụng. |
| npm | Bắt buộc | Được cài cùng Node.js, không cần tải riêng. |
| Trình duyệt | Chrome, Edge hoặc Firefox phiên bản hiện hành | Dùng trình duyệt đang có trên máy. |
| Git | Chỉ cần khi tải/chạy source code | Tải từ [git-scm.com](https://git-scm.com/downloads). Không cần cho bản ZIP demo. |

Trên Windows có `winget`, có thể cài Node.js bằng PowerShell hoặc Command Prompt:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
```

Đóng rồi mở lại terminal sau khi cài. Kiểm tra phiên bản trước khi chạy:

```sh
node --version
npm --version
```

`node --version` phải là `v24.x.x` hoặc mới hơn. Lần đầu cần Internet để npm tải dependencies. Bản mô phỏng **không cần Docker, cài SQLite riêng, Milvus server hay tài khoản TideCloak thật**.

### 2. Tải đúng gói demo

1. Mở [Releases](https://github.com/ewtherka/RMIT_SGS_sTEAM_C2/releases/latest).
2. Trong **Assets**, tải **[CareFlow-demo.zip](https://github.com/ewtherka/RMIT_SGS_sTEAM_C2/releases/latest/download/CareFlow-demo.zip)**. Không chọn `Source code (zip)` nếu chỉ muốn chạy bản đã build.
3. Giải nén **toàn bộ** ZIP vào một thư mục có quyền ghi. Không chạy trực tiếp bên trong cửa sổ xem ZIP.
4. Mở thư mục `CareFlow-demo` chứa `START-DEMO.cmd`, `scripts/`, `careflow-backend/` và `careflow-frontend/`.

### 3. Khởi động

**Windows:** nhấp đúp **START-DEMO.cmd**. Hoặc mở terminal tại thư mục vừa giải nén và chạy:

```sh
node scripts/start-demo.mjs
```

**macOS/Linux:** mở terminal tại cùng thư mục và chạy:

```sh
node scripts/start-demo.mjs --no-open
```

Launcher sẽ tự cài thư viện backend còn thiếu, tạo dữ liệu demo khi chưa có database, chạy API và giao diện. Chờ dòng **`READY: http://localhost:5173`**, rồi mở:

- **Webapp:** http://localhost:5173
- **Tài liệu API/Swagger:** http://localhost:3333/docs

Giữ cửa sổ terminal mở khi sử dụng. Nhấn **Ctrl+C** để dừng các dịch vụ do launcher khởi động. Launcher không reset database và không tự tắt tiến trình của bạn; dịch vụ CareFlow đang chạy đúng cổng sẽ được dùng lại.

Bản release đã build sẵn frontend và backend, nên **không cần cài dependencies frontend hoặc chạy build**. Nếu muốn cài dependencies backend bằng lệnh trước khi mở app, chạy từ thư mục giải nén:

```sh
npm --prefix careflow-backend ci --omit=dev --ignore-scripts
node scripts/start-demo.mjs --no-open
```

Không chạy `npm ci` ở thư mục gốc: mỗi phần của dự án có `package.json` và lockfile riêng. Đây là **webapp chạy cục bộ**, không phải file `.exe` độc lập. Link GitHub Release là link tải app, không phải website đã deploy công khai.

### 4. Sử dụng bản demo

Chọn tài khoản trong banner **Mô phỏng TideCloak**:

- **Nguyễn An:** tìm bác sĩ, đặt/đổi/hủy lịch, xem hồ sơ và gửi yêu cầu chia sẻ hoặc thu hồi quyền.
- **BS. Lan / BS. Minh:** xem lịch khám và kiểm tra quyền đọc hồ sơ.
- **Admin độc lập 1, 2, 3:** phê duyệt các yêu cầu. Cần **2 admin khác nhau**; một tài khoản không thể tự tạo đủ quorum.

Refresh trang sẽ đăng xuất vì token chỉ nằm trong bộ nhớ. Xem [kịch bản quay demo](DEMO.md) để thử cả chia sẻ hồ sơ và truy cập khẩn cấp. Chỉ dùng dữ liệu mô phỏng; không nhập dữ liệu y tế thật.

## Chạy từ source code

Phù hợp nếu muốn sửa giao diện/backend hoặc chạy kiểm thử. Cần Node.js 24+, npm và Git.

Cài Git trên Windows bằng lệnh, nếu chưa có:

```powershell
winget install --id Git.Git --exact
```

Tải source và cài đầy đủ dependencies, bao gồm công cụ build:

```sh
git clone https://github.com/ewtherka/RMIT_SGS_sTEAM_C2.git
cd RMIT_SGS_sTEAM_C2
npm --prefix careflow-backend ci --include=dev --ignore-scripts
npm --prefix careflow-frontend ci --include=dev
node scripts/start-demo.mjs --no-open
```

Launcher nhận diện source, build cả hai phần, seed database nếu cần và chạy app. Không cần tự tạo `.env` hay cung cấp secret cho đường chạy mô phỏng này; launcher tạo khóa QR khi khởi động và đặt các biến môi trường cần thiết cho tiến trình con. Đọc [hướng dẫn backend](careflow-backend/docs/SETUP.md) nếu muốn cấu hình thủ công hoặc dùng TideCloak thật.

Để cập nhật một checkout đã có: dừng app bằng Ctrl+C, rồi chạy từ thư mục gốc repo:

```sh
git pull --rebase origin main
npm --prefix careflow-backend ci --include=dev --ignore-scripts
npm --prefix careflow-frontend ci --include=dev
node scripts/start-demo.mjs --no-open
```

Không ghi đè những chỉnh sửa local chưa lưu của bạn. Nếu đang dùng ZIP, tải release mới và giải nén vào thư mục mới; database cũ không tự được chuyển sang thư mục mới.

## Dependencies

Các phiên bản bên dưới khớp với `package.json`; `npm ci` cài đúng cây dependencies trong `package-lock.json`. **Không cần `npm install` từng thư viện.**

### Frontend — runtime

| Package | Phiên bản | Vai trò |
| --- | --- | --- |
| `react`, `react-dom` | `19.1.1` | Giao diện và render webapp. |
| `@tidecloak/js`, `@tidecloak/react` | `0.14.33` | SDK và tích hợp TideCloak. |
| `lucide-react` | `0.468.0` | Icon. |
| `@fontsource/be-vietnam-pro` | `5.3.0` | Font tiếng Việt đóng gói cùng app. |

### Backend — runtime

| Package | Phiên bản | Vai trò |
| --- | --- | --- |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | `12.2.0` | API server. |
| `@nestjs/swagger` | `12.0.2` | Tài liệu OpenAPI/Swagger. |
| `@tidecloak/verify` | `0.14.33` | Xác minh TideCloak trong strict mode. |
| `@tideorg/js` | `0.14.29` | Mô hình policy của Tide. |
| `@zilliz/milvus2-sdk-node` | `3.0.6` | SDK Milvus; dịch vụ này không cần cho demo. |
| `dotenv` | `18.0.8` | Đọc cấu hình môi trường. |
| `helmet` | `8.3.0` | Security headers. |
| `jose` | `6.2.13` | JWT và xử lý xác thực. |
| `luxon` | `3.7.2` | Thời gian, lịch hẹn và múi giờ. |
| `reflect-metadata` | `0.2.2` | Metadata cho NestJS. |
| `rxjs` | `7.8.2` | Hỗ trợ luồng xử lý của NestJS. |
| `zod` | `4.6.7` | Kiểm tra dữ liệu đầu vào. |

Database dùng **`node:sqlite` có sẵn trong Node.js 24+**, không dùng một npm package SQLite riêng.

### Công cụ phát triển và kiểm thử

Chỉ cần khi chạy source; đã được cài bởi hai lệnh `npm ci --include=dev` ở trên.

- **Frontend:** `typescript@5.9.3`, `vite@7.3.1`, `@vitejs/plugin-react@5.1.1`, `vitest@3.2.4`, `playwright@1.64.1`, `@types/node@24.10.1`, `@types/react@19.1.16`, `@types/react-dom@19.1.9`.
- **Backend:** `typescript@6.0.3`, `esbuild@0.28.2`, `tsx@4.23.15`, `prettier@3.9.10`, `@types/node@24.19.2`, `@types/express@5.0.6`, `@types/luxon@3.7.6`.

Xem danh sách chính xác trực tiếp bằng npm, từ thư mục gốc source:

```sh
npm --prefix careflow-frontend pkg get dependencies devDependencies
npm --prefix careflow-backend pkg get dependencies devDependencies
```

## Kiểm thử và build

Từ thư mục gốc **source**, sau khi cài dependencies:

```sh
npm --prefix careflow-frontend test
npm --prefix careflow-frontend run build
npm --prefix careflow-backend test
```

Kiểm thử trình duyệt cần Chromium. Chạy các lệnh sau trong `careflow-frontend/`; đồng thời giữ webapp và API đang chạy ở cổng 5173/3333:

```sh
cd careflow-frontend
npx playwright install chromium
npm run test:browser
npm run test:emergency
```

Chỉ chạy browser test trên database mô phỏng dành riêng cho test: chúng tạo lịch hẹn, yêu cầu phê duyệt và audit entry, không reset database. Không dùng database đang chuẩn bị quay demo. Trên Linux, Playwright có thể yêu cầu thêm thư viện hệ thống; dùng `npx playwright install --with-deps chromium` nếu máy cho phép cài gói hệ điều hành.

## Lỗi thường gặp

- **`node`/`npm` không được nhận diện:** cài Node.js 24+ và mở terminal mới để cập nhật PATH.
- **PowerShell chặn `npm.ps1`:** dùng Command Prompt hoặc thay `npm` bằng `npm.cmd`; không cần tắt execution policy toàn máy.
- **Cổng 3333 hoặc 5173 đã bị chiếm:** tự dừng đúng ứng dụng đang chiếm cổng rồi chạy lại. Launcher không tự kill tiến trình khác.
- **Không thấy thay đổi sau cập nhật:** dừng phiên app cũ, chạy lại launcher rồi tải lại trang. Launcher có thể đang dùng lại dịch vụ cũ còn chạy.
- **Không tải được danh sách bác sĩ/đăng nhập:** kiểm tra cửa sổ launcher có báo `READY`, API ở `http://localhost:3333/health/live` hoạt động, và cả hai dịch vụ chạy trên cùng máy. Không chỉ mở riêng file `index.html` bằng trình duyệt.
- **Lần đầu cài thư viện thất bại:** kiểm tra Internet/quyền ghi thư mục, rồi chạy lại lệnh cài dependencies tương ứng với ZIP hoặc source ở trên.

## Tài liệu và giới hạn

TideCloak sign-in, roles, access checks và quorum hiện được mô phỏng tại API. Backend giữ khóa AES và kiểm tra quorum trong SQLite; bản này **không phải live Tide E2EE hoặc quorum mật mã thật**, không phải sản phẩm y tế production. Strict mode vẫn cần cấu hình và kiểm chứng Tide thật.

[Kịch bản demo](DEMO.md) · [Frontend](careflow-frontend/README.md) · [Simulated TideCloak](careflow-backend/docs/SIMULATED_TIDE.md) · [Setup với TideCloak thật](careflow-backend/docs/SETUP.md) · [API handoff](careflow-backend/docs/FRONTEND.md) · [Verification](careflow-backend/docs/VERIFICATION.md) · [OpenAPI](careflow-backend/docs/openapi.json)
