import { useEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "./api";
import { Booking, type BookingSelection } from "./Booking";
import { PrivatePages } from "./PrivatePages";
import { useSession } from "./session-context";
import type { Clinic, Doctor, Service } from "./types";
import {
  dateText,
  hasRole,
  initials,
  money,
  timeText,
  today,
  weekday,
} from "./utils";
import {
  Avatar,
  Badge,
  Empty,
  ErrorBox,
  Heading,
  Icon,
  Loading,
  Modal,
  Notice,
  useResource,
} from "./ui";

export interface Catalog {
  clinics: Clinic[];
  services: Service[];
  doctors: Doctor[];
}
export type Book = (selection?: BookingSelection) => void;
const routes: Record<string, string> = {
  overview: "Tổng quan",
  doctors: "Tìm bác sĩ",
  appointments: "Lịch hẹn của tôi",
  records: "Hồ sơ sức khỏe",
  sharing: "Quyền riêng tư",
  visits: "Lịch sử khám",
  profile: "Thông tin cá nhân",
  notifications: "Thông báo",
  doctor: "Lịch khám của tôi",
  governance: "Phê duyệt quyền truy cập",
};
function readRoute() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0] || "overview";
}

export default function App() {
  const session = useSession();
  const [route, setRoute] = useState(readRoute);
  const [navOpen, setNavOpen] = useState(false);
  const [selection, setSelection] = useState<BookingSelection | null>(null);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState("");
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<"patient" | "doctor">("patient");
  const previousUser = useRef<string | undefined>(undefined);
  const catalog = useResource(async () => {
    const [clinics, services, doctors] = await Promise.all([
      session.api.clinics(),
      session.api.services(),
      session.api.doctors(),
    ]);
    return { clinics, services, doctors };
  }, [session.api]);
  const data = catalog.value || { clinics: [], services: [], doctors: [] };
  const doctor = hasRole(session.me, "doctor");
  const patient = hasRole(session.me, "patient");
  const admin = hasRole(session.me, "admin");
  const doctorView = doctor && (!patient || view === "doctor");
  useEffect(() => {
    const update = () => {
      setRoute(readRoute());
      setNavOpen(false);
      window.scrollTo({ top: 0 });
      setTimeout(
        () =>
          document
            .querySelector<HTMLElement>("#main-content")
            ?.focus({ preventScroll: true }),
        0,
      );
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    document.title = `${routes[route] || "Tổng quan"} · CareFlow`;
  }, [route]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    document.body.classList.toggle("nav-open", navOpen);
    return () => document.body.classList.remove("nav-open");
  }, [navOpen]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    if (previousUser.current && previousUser.current !== session.me?.id)
      setSelection(null);
    previousUser.current = session.me?.id;
  }, [session.me?.id]);
  useEffect(() => {
    if (
      session.status === "authenticated" &&
      session.me &&
      window.location.pathname === "/auth/redirect"
    )
      history.replaceState(
        null,
        "",
        `/${window.location.hash || "#/overview"}`,
      );
  }, [session.status, session.me]);
  const book: Book = (value = {}) => {
    if (!data.services.length) {
      setToast("Danh mục dịch vụ chưa sẵn sàng. Hãy tải lại dữ liệu.");
      return;
    }
    setSelection(value);
  };
  const nav = admin
    ? [["governance", "shield", "Phê duyệt quyền truy cập"]]
    : doctorView
      ? [
          ["doctor", "calendar", "Lịch khám của tôi"],
          ["records", "file", "Hồ sơ bệnh nhân"],
        ]
      : [
          ["overview", "grid", "Tổng quan"],
          ["doctors", "stethoscope", "Tìm bác sĩ"],
          ["appointments", "calendar", "Lịch hẹn của tôi"],
          ["records", "file", "Hồ sơ sức khỏe"],
          ["visits", "activity", "Lịch sử khám"],
          ["sharing", "shield", "Quyền riêng tư"],
        ];
  const login = () =>
    session.login().catch((error) => setToast(errorMessage(error)));
  let content: ReactNode;
  if (route === "doctors")
    content = (
      <Doctors
        catalog={data}
        loading={catalog.loading}
        error={catalog.error}
        retry={catalog.reload}
        book={book}
      />
    );
  else if (route === "overview" || !routes[route])
    content = (
      <Overview
        catalog={data}
        loading={catalog.loading}
        error={catalog.error}
        retry={catalog.reload}
        book={book}
        revision={revision}
        login={login}
      />
    );
  else
    content = (
      <PrivateGate login={login}>
        <PrivatePages
          key={`${session.me?.id}-${doctorView}`}
          route={route}
          catalog={data}
          book={book}
          revision={revision}
          changed={() => setRevision((value) => value + 1)}
          notify={setToast}
          doctorView={doctorView}
        />
      </PrivateGate>
    );

  return (
    <>
      <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />
      <aside className="sidebar" aria-label="Điều hướng chính">
        <a className="brand" href="#/overview">
          <span className="brand-mark">
            <Icon name="plus" />
          </span>
          <span>
            CareFlow<span className="brand-dot">.</span>
            <small>CHĂM SÓC TỪ SỰ AN TÂM</small>
          </span>
        </a>
        <div className="workspace-label">
          {admin
            ? "QUẢN TRỊ ĐỘC LẬP"
            : doctorView
              ? "KHÔNG GIAN BÁC SĨ"
              : "KHÔNG GIAN CỦA BẠN"}
        </div>
        <nav>
          {nav.map(([id, icon, title]) => (
            <a
              key={id}
              className={`nav-item ${route === id ? "active" : ""}`}
              href={`#/${id}`}
              aria-current={route === id ? "page" : undefined}
            >
              <Icon name={icon} />
              <span>{title}</span>
              {id === "appointments" && <span className="nav-mini-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card">
            <span className="support-icon">
              <Icon name="heart" />
            </span>
            <strong>Luôn ở đây vì bạn</strong>
            <p>Cùng bạn chủ động chăm sóc sức khỏe mỗi ngày.</p>
            <button className="text-button" onClick={() => setHelp(true)}>
              Hướng dẫn sử dụng
              <Icon name="arrow" />
            </button>
          </div>
          <a
            className={`nav-item ${route === "profile" ? "active" : ""}`}
            href="#/profile"
          >
            <Icon name="users" />
            <span>Thông tin cá nhân</span>
          </a>
          <div className="demo-note">
            <span className="live-dot" />
            <span>
              CareFlow · UNLOCKED
              <small>Kết nối API · Dữ liệu phòng khám mẫu</small>
            </span>
            <Icon name="shield" />
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-location">
            <button
              className="icon-button mobile-menu"
              aria-label="Mở điều hướng"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(!navOpen)}
            >
              <Icon name="menu" />
            </button>
            <span className="breadcrumb-root">
              {doctorView ? "Không gian bác sĩ" : "Không gian bệnh nhân"}
            </span>
            <Icon name="chevron" />
            <span>{routes[route] || "Tổng quan"}</span>
          </div>
          <div className="topbar-actions">
            {doctor && patient ? (
              <label className="role-control">
                <span className="role-dot" />
                <select
                  aria-label="Góc nhìn theo vai trò"
                  value={view}
                  onChange={(event) => {
                    setView(event.target.value as "patient" | "doctor");
                    window.location.hash =
                      event.target.value === "doctor" ? "/doctor" : "/overview";
                  }}
                >
                  <option value="patient">Bệnh nhân</option>
                  <option value="doctor">Bác sĩ</option>
                </select>
                <Icon name="down" />
              </label>
            ) : (
              <span className="environment-pill">
                <span />
                {session.mode === "simulation"
                  ? "Tide mô phỏng"
                  : "Bản thử nghiệm"}
              </span>
            )}
            <a
              href="#/notifications"
              className="icon-button notification-button"
              aria-label="Thông báo"
            >
              <Icon name="bell" />
            </a>
            <span className="topbar-divider" />
            {session.me && !session.me.onboardingRequired ? (
              <a href="#/profile" className="profile-button">
                <span className="patient-avatar">
                  {initials(session.me.displayName || "")}
                </span>
                <span className="profile-copy">
                  <strong>{session.me.displayName}</strong>
                  <small>
                    {doctorView ? "Tài khoản bác sĩ" : "Tài khoản của bạn"}
                  </small>
                </span>
                <Icon name="down" />
              </a>
            ) : (
              <button
                className="button light small header-login"
                onClick={login}
              >
                <Icon name="login" />
                Đăng nhập
              </button>
            )}
          </div>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          {session.mode === "simulation" && (
            <div className="simulation-banner">
              <Icon name="shield" />
              <span>
                <strong>Mô phỏng TideCloak</strong> · Đăng nhập, vai trò và
                quyền truy cập dùng dữ liệu mô phỏng.
              </span>
              <button onClick={session.showAccounts}>
                {session.me ? "Đổi tài khoản" : "Chọn tài khoản"}
                <Icon name="arrow" />
              </button>
            </div>
          )}
          {session.status === "unconfigured" && (
            <div className="connection-banner">
              <Icon name="lock" />
              <span>
                <strong>Chưa cấu hình đăng nhập Tide.</strong> Bạn vẫn có thể
                tìm bác sĩ và xem lịch trống.
              </span>
              <button
                onClick={session.retry}
                aria-label="Kiểm tra lại cấu hình Tide"
              >
                <Icon name="refresh" />
              </button>
            </div>
          )}
          {session.error && (
            <ErrorBox error={session.error} retry={session.retry} />
          )}
          {content}
        </main>
        <footer className="page-footer">
          <span>© {today().slice(0, 4)} CareFlow. Chăm sóc từ sự an tâm.</span>
          <span>
            <Icon name="shield" />
            {session.mode === "simulation"
              ? "Mô phỏng bảo vệ bởi TideCloak · Không dùng dữ liệu thật"
              : "Tích hợp TideCloak · Trạng thái quyền cần xác minh"}
          </span>
        </footer>
      </div>
      {selection && (
        <Booking
          selection={selection}
          services={data.services}
          doctors={data.doctors}
          onClose={() => setSelection(null)}
          onBooked={() => setRevision((value) => value + 1)}
        />
      )}
      {help && (
        <Modal
          title="Bắt đầu cùng CareFlow"
          subtitle="Một vài bước để chủ động chăm sóc sức khỏe."
          onClose={() => setHelp(false)}
          footer={
            <button
              className="button primary"
              onClick={() => {
                setHelp(false);
                window.location.hash = "/doctors";
              }}
            >
              Tìm bác sĩ
              <Icon name="arrow" />
            </button>
          }
        >
          <ol className="help-steps">
            <li>
              <strong>Tìm dịch vụ và bác sĩ</strong>
              <p>Tra cứu danh mục và khung giờ đang còn trống từ phòng khám.</p>
            </li>
            <li>
              <strong>Đăng nhập và đặt lịch</strong>
              <p>
                Sử dụng tài khoản Tide, kiểm tra thông tin rồi xác nhận lịch
                hẹn.
              </p>
            </li>
            <li>
              <strong>Theo dõi hành trình khám</strong>
              <p>Quản lý lịch hẹn, lịch sử và đề nghị tái khám của bác sĩ.</p>
            </li>
            <li>
              <strong>Chủ động chia sẻ hồ sơ</strong>
              <p>
                Gửi yêu cầu chia sẻ hoặc thu hồi. Hiệu lực thực tế cần được xác
                minh qua Tide.
              </p>
            </li>
          </ol>
          <Notice>
            Đây là ứng dụng dự thi với dữ liệu phòng khám mẫu. Chưa triển khai
            khám bệnh hoặc thanh toán thực tế.
          </Notice>
        </Modal>
      )}
      {toast && createToast(toast, () => setToast(""))}
    </>
  );
}
function createToast(message: string, close: () => void) {
  return (
    <div className="toast" role="status">
      <Icon name="check" />
      <span>{message}</span>
      <button
        className="icon-button"
        aria-label="Đóng thông báo"
        onClick={close}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

function PrivateGate({
  children,
  login,
}: {
  children: ReactNode;
  login: () => void;
}) {
  const session = useSession();
  if (
    session.status === "loading" ||
    (session.status === "authenticated" && !session.me && !session.error)
  )
    return <Loading label="Đang khôi phục phiên của bạn…" />;
  if (session.status !== "authenticated")
    return (
      <>
        <Heading
          eyebrow="KHÔNG GIAN RIÊNG CỦA BẠN"
          title="Sức khỏe, được kết nối."
          text="Đăng nhập để quản lý lịch hẹn và hồ sơ trong cùng một không gian."
        />
        <section className="sign-in-gate panel">
          <div className="gate-illustration">
            <Icon name="shield" />
          </div>
          <span className="eyebrow">DÀNH RIÊNG CHO BẠN</span>
          <h2>
            Chăm sóc liền mạch,
            <br />
            bắt đầu từ một kết nối.
          </h2>
          <p>
            Đặt lịch, theo dõi kết quả và chủ động quản lý
            <br className="desktop-break" /> quyền truy cập hồ sơ bằng tài khoản
            Tide.
          </p>
          <button className="button primary" onClick={login}>
            {session.status === "unconfigured"
              ? "Kiểm tra cấu hình Tide"
              : "Đăng nhập bằng Tide"}
            <Icon
              name={session.status === "unconfigured" ? "refresh" : "arrow"}
            />
          </button>
          {session.status === "unconfigured" && (
            <div className="gate-status">
              <span className="badge-dot" />
              Máy chủ đang chờ cấu hình Tide. Chưa thể đăng nhập.
            </div>
          )}
          <a className="text-button" href="#/doctors">
            Tiếp tục tìm bác sĩ
            <Icon name="arrow" />
          </a>
        </section>
      </>
    );
  if (!session.me)
    return (
      <ErrorBox
        error={session.error || "Chưa lấy được thông tin tài khoản."}
        retry={() => {
          session.reloadMe().catch(() => {});
        }}
      />
    );
  return children;
}

function Overview({
  catalog,
  loading,
  error,
  retry,
  book,
  revision,
  login,
}: {
  catalog: Catalog;
  loading: boolean;
  error: unknown;
  retry: () => void;
  book: Book;
  revision: number;
  login: () => void;
}) {
  const session = useSession();
  const privateData = useResource(
    async () =>
      session.me && !session.me.onboardingRequired
        ? session.api.appointments()
        : null,
    [session.api, session.me?.id, revision],
  );
  const next = session.me
    ? privateData.value?.items
        .filter((item) =>
          ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS"].includes(item.status),
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
    : undefined;
  return (
    <>
      <Heading
        eyebrow={`${weekday(today())}, ${dateText(today(), true)}`}
        title={
          <>
            Chào{" "}
            {session.me?.displayName
              ?.replace(/\([^)]*\)/g, "")
              .trim()
              .split(" ")
              .slice(-2)
              .join(" ") || "bạn"}
            , <span className="greeting-sun">✳</span>
          </>
        }
        text="Một ngày tốt lành bắt đầu từ việc quan tâm đến bản thân."
        action={
          <button className="button primary" onClick={() => book()}>
            <Icon name="plus" />
            Đặt lịch khám
          </button>
        }
      />
      <div className="welcome-grid">
        <section className="welcome-card">
          <div className="welcome-copy">
            <span className="welcome-eyebrow">
              <span />
              SỨC KHỎE CỦA BẠN, ƯU TIÊN CỦA CHÚNG TÔI
            </span>
            <h2>
              Chủ động hôm nay,
              <br />
              <span>an tâm mỗi ngày.</span>
            </h2>
            <p>
              Đặt lịch dễ dàng. Theo dõi sức khỏe.
              <br />
              Giữ kết nối với bác sĩ bạn tin tưởng.
            </p>
            <a className="button primary" href="#/doctors">
              Tìm bác sĩ phù hợp
              <Icon name="arrow" />
            </a>
            <div className="welcome-assurance">
              <Icon name="shield" />
              Bạn chủ động yêu cầu chia sẻ hồ sơ.
            </div>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <div className="art-orbit orbit-1" />
            <div className="art-orbit orbit-2" />
            <div className="art-cross">
              <Icon name="plus" />
            </div>
            <div className="art-record">
              <div className="art-record-icon">
                <Icon name="heart" />
              </div>
              <div>
                <strong>Hồ sơ sức khỏe</strong>
                <span>Mọi thông tin, một nơi.</span>
              </div>
              <span className="art-check">
                <Icon name="check" />
              </span>
            </div>
            <div className="art-pill">
              <Icon name="activity" />
              Chăm sóc trọn vẹn
            </div>
            <span className="art-spark spark-1">+</span>
            <span className="art-spark spark-2">+</span>
          </div>
        </section>
        <section className="next-card panel">
          <div className="section-heading">
            <h2>Lịch hẹn sắp tới</h2>
            <Badge color={next ? "green" : "blue"}>
              {next ? "Đã xác nhận" : "Không gian của bạn"}
            </Badge>
          </div>
          {privateData.loading && session.me ? (
            <Loading />
          ) : privateData.error ? (
            <ErrorBox error={privateData.error} retry={privateData.reload} />
          ) : next ? (
            <>
              <div className="next-doctor">
                <Avatar name={next.doctorName} size="medium" />
                <div>
                  <h3>{next.doctorName}</h3>
                  <p>{next.serviceName}</p>
                </div>
              </div>
              <div className="appointment-time">
                <div>
                  <Icon name="calendar" />
                  <span>
                    Ngày khám<strong>{dateText(next.startsAt, true)}</strong>
                  </span>
                </div>
                <div>
                  <Icon name="clock" />
                  <span>
                    Giờ hẹn
                    <strong>
                      {timeText(next.startsAt)} – {timeText(next.endsAt)}
                    </strong>
                  </span>
                </div>
              </div>
              <div className="location-line">
                <Icon name="pin" />
                {next.clinic.name}
              </div>
              <a href="#/appointments" className="button light full">
                Xem lịch hẹn
                <Icon name="arrow" />
              </a>
            </>
          ) : (
            <div className="next-empty">
              <span className="next-empty-icon">
                <Icon name="calendar" />
              </span>
              <h3>
                {session.me
                  ? "Dành thời gian cho sức khỏe"
                  : "Lịch hẹn, luôn trong tầm tay"}
              </h3>
              <p>
                {session.me
                  ? "Chọn bác sĩ và khung giờ phù hợp với bạn."
                  : "Đăng nhập để theo dõi và quản lý lịch khám của bạn tại đây."}
              </p>
              <button
                className="button light full"
                onClick={session.me ? () => book() : login}
              >
                {session.me ? "Đặt lịch đầu tiên" : "Kết nối tài khoản Tide"}
                <Icon name="arrow" />
              </button>
            </div>
          )}
        </section>
      </div>
      <div className="stats-grid">
        <a className="stat-card" href="#/doctors">
          <span className="stat-icon blue">
            <Icon name="stethoscope" />
          </span>
          <div>
            <span>Bác sĩ đồng hành</span>
            <strong>
              {loading ? "—" : String(catalog.doctors.length).padStart(2, "0")}
              <small>bác sĩ trong hệ thống</small>
            </strong>
          </div>
          <Icon name="chevron" className="stat-chevron" />
        </a>
        <a className="stat-card" href="#/doctors">
          <span className="stat-icon mint">
            <Icon name="heart" />
          </span>
          <div>
            <span>Dịch vụ chăm sóc</span>
            <strong>
              {loading ? "—" : String(catalog.services.length).padStart(2, "0")}
              <small>dịch vụ hiện có</small>
            </strong>
          </div>
          <Icon name="chevron" className="stat-chevron" />
        </a>
        <a className="stat-card" href="#/sharing">
          <span className="stat-icon purple">
            <Icon name="shield" />
          </span>
          <div>
            <span>Quyền riêng tư</span>
            <strong className="stat-word">
              Chủ động<small>quản lý yêu cầu chia sẻ</small>
            </strong>
          </div>
          <Icon name="chevron" className="stat-chevron" />
        </a>
      </div>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Gặp bác sĩ phù hợp với bạn</h2>
            <p>Chọn sự chăm sóc phù hợp với nhu cầu của bạn.</p>
          </div>
          <a className="text-button" href="#/doctors">
            Xem tất cả
            <Icon name="arrow" />
          </a>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} retry={retry} />
        ) : !catalog.doctors.length ? (
          <Empty
            title="Chưa có bác sĩ trong danh mục"
            text="Phòng khám sẽ cập nhật danh sách tại đây."
          />
        ) : (
          <div className="doctor-grid recommended live-doctor-grid">
            {catalog.doctors.slice(0, 3).map((doctor, index) => (
              <DoctorCard
                key={doctor.id}
                doctor={doctor}
                index={index}
                catalog={catalog}
                book={book}
              />
            ))}
          </div>
        )}
      </section>
      <div className="bottom-grid">
        <section className="panel prepare-card">
          <div className="section-heading">
            <h2>Một chút chuẩn bị, thêm an tâm</h2>
            <span className="mini-tag">TRƯỚC BUỔI KHÁM</span>
          </div>
          <div className="prepare-row">
            <span className="record-icon blue">
              <Icon name="file" />
            </span>
            <div>
              <strong>Chuẩn bị thông tin cần trao đổi</strong>
              <p>Ghi lại câu hỏi và mang theo kết quả khám trước đó.</p>
            </div>
          </div>
          <div className="prepare-row">
            <span className="record-icon mint">
              <Icon name="clock" />
            </span>
            <div>
              <strong>Dành thời gian cho chính mình</strong>
              <p>Đến sớm khoảng 10 phút để chuẩn bị cho buổi khám.</p>
            </div>
          </div>
        </section>
        <section className="privacy-promo">
          <div className="privacy-promo-symbol">
            <Icon name="shield" />
          </div>
          <div>
            <span className="eyebrow">QUYỀN RIÊNG TƯ TRONG TAY BẠN</span>
            <h2>
              Hồ sơ của bạn.
              <br />
              Quyết định của bạn.
            </h2>
            <p>
              Theo dõi yêu cầu chia sẻ và trạng thái xác minh quyền truy cập.
            </p>
            <a className="text-button" href="#/sharing">
              Quản lý quyền riêng tư
              <Icon name="arrow" />
            </a>
          </div>
          <span className="promo-decoration" aria-hidden="true">
            +
          </span>
        </section>
      </div>
    </>
  );
}

function DoctorCard({
  doctor,
  index,
  catalog,
  book,
  serviceId,
}: {
  doctor: Doctor;
  index: number;
  catalog: Catalog;
  book: Book;
  serviceId?: string;
}) {
  const clinic = catalog.clinics.find((item) => item.id === doctor.clinicId);
  return (
    <article className="doctor-card">
      <div className="doctor-card-top">
        <Avatar name={doctor.displayName} size="large" index={index} />
        <span className="doctor-live-badge">
          <span />
          Theo lịch phòng khám
        </span>
      </div>
      <div className="doctor-specialty">{doctor.specialty}</div>
      <h3>{doctor.displayName}</h3>
      <p className="doctor-experience">
        <Icon name="pin" />
        {clinic?.name || "Phòng khám"}
      </p>
      <div className="doctor-card-bottom">
        <div>
          <small>Ngôn ngữ tư vấn</small>
          <strong>
            {doctor.languages
              .map((language) => (language === "vi" ? "Tiếng Việt" : language))
              .join(", ") || "Chưa cập nhật"}
          </strong>
        </div>
        <button
          className="button light small"
          onClick={() => book({ doctorId: doctor.id, serviceId })}
        >
          Xem lịch trống
          <Icon name="arrow" />
        </button>
      </div>
    </article>
  );
}
function Doctors({
  catalog,
  loading,
  error,
  retry,
  book,
}: {
  catalog: Catalog;
  loading: boolean;
  error: unknown;
  retry: () => void;
  book: Book;
}) {
  const session = useSession();
  const [serviceId, setServiceId] = useState("");
  const [query, setQuery] = useState("");
  const doctors = useResource(
    () => session.api.doctors(serviceId || undefined),
    [serviceId, session.api],
  );
  const normalized = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase();
  const filtered = (doctors.value || []).filter((doctor) =>
    normalized(`${doctor.displayName} ${doctor.specialty}`).includes(
      normalized(query.trim()),
    ),
  );
  return (
    <>
      <Heading
        eyebrow="CHỌN SỰ CHĂM SÓC PHÙ HỢP"
        title="Tìm bác sĩ của bạn"
        text="Tìm một người lắng nghe, thấu hiểu và đồng hành cùng bạn."
      />
      <section className="search-panel">
        <form
          className="search-field"
          onSubmit={(event) => event.preventDefault()}
        >
          <Icon name="search" />
          <input
            type="search"
            aria-label="Tìm bác sĩ"
            placeholder="Tìm theo tên bác sĩ hoặc chuyên khoa…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="button primary small">Tìm kiếm</button>
        </form>
        <div
          className="specialty-filters"
          role="group"
          aria-label="Lọc theo dịch vụ"
        >
          <button
            className={`filter-chip ${!serviceId ? "selected" : ""}`}
            aria-pressed={!serviceId}
            onClick={() => setServiceId("")}
          >
            <Icon name="grid" />
            Tất cả dịch vụ
          </button>
          {catalog.services.map((service) => (
            <button
              key={service.id}
              className={`filter-chip ${serviceId === service.id ? "selected" : ""}`}
              aria-pressed={serviceId === service.id}
              onClick={() => setServiceId(service.id)}
            >
              <Icon name="stethoscope" />
              {service.name}
            </button>
          ))}
        </div>
      </section>
      <div className="results-heading">
        <h2>
          Bác sĩ dành cho bạn <span>({filtered.length})</span>
        </h2>
        <span className="muted">
          <Icon name="check" />
          Danh mục từ phòng khám
        </span>
      </div>
      {loading || doctors.loading ? (
        <Loading />
      ) : error || doctors.error ? (
        <ErrorBox
          error={error || doctors.error}
          retry={() => {
            retry();
            doctors.reload();
          }}
        />
      ) : filtered.length ? (
        <div className="doctor-grid all-doctors">
          {filtered.map((doctor, index) => (
            <DoctorCard
              key={doctor.id}
              doctor={doctor}
              index={index}
              catalog={catalog}
              book={book}
              serviceId={serviceId || undefined}
            />
          ))}
        </div>
      ) : (
        <Empty
          icon="search"
          title="Chưa tìm thấy bác sĩ phù hợp"
          text="Thử tên khác hoặc chọn tất cả dịch vụ."
        >
          <button
            className="button light"
            onClick={() => {
              setQuery("");
              setServiceId("");
            }}
          >
            Xóa bộ lọc
          </button>
        </Empty>
      )}
      <section className="services-section">
        <div className="section-heading">
          <h2>Dịch vụ hiện có</h2>
          <span className="muted">
            Giá tham khảo · Không thanh toán trực tuyến
          </span>
        </div>
        <div className="service-grid">
          {catalog.services.map((service) => (
            <button
              key={service.id}
              className="service-card"
              onClick={() => book({ serviceId: service.id })}
            >
              <span className="stat-icon mint">
                <Icon name="pulse" />
              </span>
              <div>
                <strong>{service.name}</strong>
                <p>
                  {service.durationMinutes} phút · {money(service.feeVnd)}
                </p>
                <small>{service.description}</small>
              </div>
              <Icon name="arrow" />
            </button>
          ))}
        </div>
      </section>
      <Notice>
        Danh mục hiện dùng dữ liệu phòng khám mẫu. Lịch trống được tải trực tiếp
        từ API và kiểm tra lại khi bạn xác nhận.
      </Notice>
    </>
  );
}
