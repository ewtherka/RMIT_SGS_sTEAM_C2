import { useRef, useState, type FormEvent } from "react";
import type { Book, Catalog } from "./App";
import { ApiError, errorMessage } from "./api";
import { useSession } from "./session-context";
import Governance, { SharingProgress, SimRecordAccess } from "./Governance";
import type {
  Appointment,
  MedicalRecord,
  Notification,
  Policies,
  Sharing,
  Visit,
} from "./types";
import {
  canAttend,
  canPatientChange,
  dateOf,
  dateText,
  decodeBase64,
  hasRole,
  initials,
  money,
  statusLabels,
  timeText,
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
  Pager,
  useResource,
} from "./ui";

interface Props {
  route: string;
  catalog: Catalog;
  book: Book;
  revision: number;
  changed: () => void;
  notify: (message: string) => void;
  doctorView: boolean;
}
export function PrivatePages(props: Props) {
  const session = useSession();
  if (session.me?.onboardingRequired)
    return <Profile catalog={props.catalog} notify={props.notify} />;
  const patient = hasRole(session.me, "patient");
  if (props.route === "governance")
    return hasRole(session.me, "admin") && session.mode === "simulation" ? (
      <Governance notify={props.notify} />
    ) : (
      <Empty
        icon="lock"
        title="Chỉ quản trị viên được vào mục này"
        text="Vai trò hiện tại không có quyền phê duyệt."
      />
    );
  if (
    (props.route === "doctor" && !hasRole(session.me, "doctor")) ||
    (props.route === "records" && !patient && !hasRole(session.me, "doctor"))
  )
    return (
      <Empty
        icon="lock"
        title="Bạn không có quyền vào mục này"
        text="Vai trò hiện tại không được phép sử dụng chức năng này."
      >
        <a className="button light" href="#/overview">
          Về tổng quan
        </a>
      </Empty>
    );
  if (["sharing", "visits", "appointments"].includes(props.route) && !patient)
    return (
      <Empty
        icon="lock"
        title="Mục này dành cho bệnh nhân"
        text="Bạn có thể theo dõi lịch khám và hồ sơ được phân công trong không gian bác sĩ."
      >
        <a className="button light" href="#/doctor">
          Lịch khám của tôi
        </a>
      </Empty>
    );
  if (props.route === "appointments" || props.route === "doctor")
    return <Appointments {...props} doctorView={props.route === "doctor"} />;
  if (props.route === "records") return <Records {...props} />;
  if (props.route === "sharing") return <SharingPage {...props} />;
  if (props.route === "visits") return <Visits {...props} />;
  if (props.route === "notifications")
    return <Notifications notify={props.notify} />;
  return <Profile catalog={props.catalog} notify={props.notify} />;
}

function Appointments({ book, revision, changed, notify, doctorView }: Props) {
  const session = useSession();
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState("upcoming");
  const [detail, setDetail] = useState<Appointment | null>(null);
  const resource = useResource(
    () => session.api.appointments(offset),
    [session.api, offset, revision],
  );
  const items = resource.value?.items || [];
  const filtered = items
    .filter((item) =>
      tab === "upcoming"
        ? ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS"].includes(item.status)
        : tab === "completed"
          ? item.status === "COMPLETED"
          : ["CANCELLED", "NO_SHOW"].includes(item.status),
    )
    .sort((a, b) =>
      tab === "upcoming"
        ? a.startsAt.localeCompare(b.startsAt)
        : b.startsAt.localeCompare(a.startsAt),
    );
  return (
    <>
      <Heading
        eyebrow={doctorView ? "KHÔNG GIAN BÁC SĨ" : "MỌI LỊCH HẸN, MỘT NƠI"}
        title={doctorView ? "Lịch khám của tôi" : "Lịch hẹn của tôi"}
        text={
          doctorView
            ? "Theo dõi các lịch khám được máy chủ phân công cho tài khoản của bạn."
            : "Sắp xếp thời gian để chăm sóc điều quan trọng nhất — chính bạn."
        }
        action={
          !doctorView && (
            <button className="button primary" onClick={() => book()}>
              <Icon name="plus" />
              Đặt lịch khám
            </button>
          )
        }
      />
      <div className="tabs" role="tablist" aria-label="Trạng thái lịch hẹn">
        {[
          ["upcoming", "Sắp tới / đang khám"],
          ["completed", "Hoàn thành"],
          ["cancelled", "Đã hủy / vắng"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? "selected" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorBox error={resource.error} retry={resource.reload} />
      ) : (
        <>
          <section
            className="appointments-list"
            role="tabpanel"
            aria-label="Danh sách lịch hẹn"
          >
            {filtered.length ? (
              filtered.map((item) => (
                <article className="appointment-card" key={item.id}>
                  <div className="appointment-date-block">
                    <span>THÁNG {dateOf(item.startsAt).slice(5, 7)}</span>
                    <strong>{dateOf(item.startsAt).slice(8)}</strong>
                    <small>{dateText(item.startsAt, true)}</small>
                  </div>
                  <div className="appointment-doctor">
                    <Avatar name={item.doctorName} size="medium" />
                    <div>
                      <h3>{item.doctorName}</h3>
                      <p>{item.serviceName}</p>
                      <div className="appointment-meta">
                        <span>
                          <Icon name="clock" />
                          {timeText(item.startsAt)} – {timeText(item.endsAt)}
                        </span>
                        <span>
                          <Icon name="pin" />
                          {item.clinic.name}
                        </span>
                      </div>
                      {item.disruptionStatus === "ACTION_REQUIRED" && (
                        <span className="action-required">
                          Lịch có thay đổi · Cần bạn chọn lại thời gian
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="appointment-card-actions">
                    <Badge
                      color={
                        item.status === "CANCELLED" || item.status === "NO_SHOW"
                          ? "gray"
                          : "green"
                      }
                    >
                      {statusLabels[item.status]}
                    </Badge>
                    <div>
                      <button
                        className="text-button"
                        onClick={() => setDetail(item)}
                      >
                        Chi tiết
                        <Icon name="chevron" />
                      </button>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <Empty
                icon="calendar"
                title="Chưa có lịch hẹn trong mục này"
                text="Lịch phù hợp sẽ xuất hiện tại đây."
              >
                {!doctorView && (
                  <button className="button light" onClick={() => book()}>
                    Tìm lịch khám
                    <Icon name="arrow" />
                  </button>
                )}
              </Empty>
            )}
          </section>
          <Pager offset={offset} count={items.length} onChange={setOffset} />
          {items.length >= 30 && (
            <p className="pagination-note">
              Bộ lọc trạng thái áp dụng trong trang hiện tại.
            </p>
          )}
        </>
      )}
      <Notice>
        {doctorView
          ? "Quyền thao tác phụ thuộc phân công khám và vai trò đã xác minh. Máy chủ luôn kiểm tra lại mỗi yêu cầu."
          : "Đến sớm khoảng 10 phút và mang theo thông tin cần trao đổi với bác sĩ."}
      </Notice>
      {detail && (
        <AppointmentDetail
          appointment={detail}
          doctorView={doctorView}
          onClose={() => setDetail(null)}
          onChanged={(value) => {
            setDetail(value);
            changed();
            resource.reload();
          }}
          book={(value) => {
            setDetail(null);
            book(value);
          }}
          notify={notify}
        />
      )}
    </>
  );
}

function AppointmentDetail({
  appointment,
  doctorView,
  onClose,
  onChanged,
  book,
  notify,
}: {
  appointment: Appointment;
  doctorView: boolean;
  onClose: () => void;
  onChanged: (value: Appointment) => void;
  book: Book;
  notify: (message: string) => void;
}) {
  const session = useSession();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const ownPatient =
    hasRole(session.me, "patient") &&
    session.me?.patientProfileId === appointment.patientProfileId;
  async function act(
    action: "cancel" | "attendance-confirmation" | "start" | "complete",
  ) {
    if (busy) return;
    const fingerprint = `${appointment.id}:${action}:${appointment.version}`;
    if (!request.current || request.current.fingerprint !== fingerprint)
      request.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const result = await session.api.appointmentAction(
        appointment.id,
        action,
        appointment.version,
        request.current.key,
      );
      onChanged(result);
      setConfirmCancel(false);
      request.current = null;
      notify(
        action === "cancel"
          ? "Đã hủy lịch hẹn."
          : action === "attendance-confirmation"
            ? "Đã xác nhận bạn sẽ đến. Đây chưa phải thao tác check-in."
            : "Đã cập nhật trạng thái khám.",
      );
    } catch (reason) {
      setError(reason);
      if (reason instanceof ApiError && reason.code === "VERSION_CONFLICT") {
        try {
          onChanged(await session.api.appointment(appointment.id));
          request.current = null;
        } catch {
          /* Keep the original error; let the user retry loading. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={confirmCancel ? "Hủy lịch hẹn này?" : "Chi tiết lịch hẹn"}
      subtitle={`Mã lịch hẹn: ${appointment.id}`}
      onClose={busy ? () => {} : onClose}
      footer={
        confirmCancel ? (
          <>
            <button
              className="button light"
              disabled={busy}
              onClick={() => setConfirmCancel(false)}
            >
              Giữ lịch hẹn
            </button>
            <button
              className="button danger-fill"
              disabled={busy}
              onClick={() => act("cancel")}
            >
              {busy ? "Đang xử lý…" : "Xác nhận hủy lịch"}
            </button>
          </>
        ) : (
          <div className="detail-actions">
            {!doctorView && ownPatient && canPatientChange(appointment) && (
              <>
                <button
                  className="button ghost danger"
                  disabled={busy}
                  onClick={() => setConfirmCancel(true)}
                >
                  Hủy lịch
                </button>
                <button
                  className="button light"
                  disabled={busy}
                  onClick={() => book({ existing: appointment })}
                >
                  <Icon name="calendar" />
                  Đổi lịch
                </button>
                {canAttend(appointment) && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => act("attendance-confirmation")}
                  >
                    <Icon name="check" />
                    Tôi sẽ đến
                  </button>
                )}
              </>
            )}
            {doctorView &&
              hasRole(session.me, "doctor") &&
              appointment.disruptionStatus === "NONE" &&
              (appointment.status === "CHECKED_IN" ||
                appointment.status === "IN_PROGRESS") && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      appointment.status === "CHECKED_IN"
                        ? "start"
                        : "complete",
                    )
                  }
                >
                  {busy
                    ? "Đang xử lý…"
                    : appointment.status === "CHECKED_IN"
                      ? "Bắt đầu khám"
                      : "Hoàn tất khám"}
                </button>
              )}
            <button className="button ghost" disabled={busy} onClick={onClose}>
              Đóng
            </button>
          </div>
        )
      }
    >
      {Boolean(error) && <ErrorBox error={error} />}
      {confirmCancel ? (
        <p className="confirmation-copy">
          Lịch hẹn sẽ được chuyển sang “Đã hủy”. Bạn có thể chọn một thời gian
          khác khi cần.
        </p>
      ) : (
        <>
          <div className="appointment-detail-status">
            <Badge>{statusLabels[appointment.status]}</Badge>
            {appointment.attendanceConfirmation === "ATTENDING" && (
              <Badge color="blue">Đã xác nhận sẽ đến</Badge>
            )}
          </div>
          <div className="booking-doctor">
            <Avatar name={appointment.doctorName} size="medium" />
            <div>
              <h3>{appointment.doctorName}</h3>
              <p>{appointment.serviceName}</p>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Ngày khám</dt>
              <dd>{dateText(appointment.startsAt, true)}</dd>
            </div>
            <div>
              <dt>Giờ khám</dt>
              <dd>
                {timeText(appointment.startsAt)} –{" "}
                {timeText(appointment.endsAt)}
              </dd>
            </div>
            <div>
              <dt>Phòng khám</dt>
              <dd>{appointment.clinic.name}</dd>
            </div>
            <div>
              <dt>Địa chỉ</dt>
              <dd>{appointment.clinic.address || "Chưa cập nhật"}</dd>
            </div>
            <div>
              <dt>Hướng dẫn đến khám</dt>
              <dd>
                {appointment.clinic.arrivalInstructions ||
                  "Liên hệ phòng khám để được hướng dẫn."}
              </dd>
            </div>
            <div>
              <dt>Phí tham khảo</dt>
              <dd>{money(appointment.feeVnd)}</dd>
            </div>
          </dl>
          {appointment.disruptionStatus === "ACTION_REQUIRED" && (
            <Notice>
              Phòng khám có thay đổi vận hành. Vui lòng chọn “Đổi lịch” để xem
              các giờ thay thế, hoặc hủy. Lịch không được tự động chuyển.
            </Notice>
          )}
        </>
      )}
    </Modal>
  );
}

function Records({ revision, doctorView, notify }: Props) {
  const { api, mode } = useSession();
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<MedicalRecord | null>(null);
  const [create, setCreate] = useState(false);
  const resource = useResource(
    () => api.records(offset),
    [api, offset, revision],
  );
  return (
    <>
      <Heading
        eyebrow="LƯU GIỮ HÀNH TRÌNH CHĂM SÓC"
        title={doctorView ? "Hồ sơ bệnh nhân" : "Hồ sơ sức khỏe"}
        text={
          doctorView
            ? "Các tài liệu thuộc phạm vi phân công của bạn. Nội dung cần được Tide cho phép giải mã."
            : "Theo dõi tài liệu sức khỏe và chủ động quản lý yêu cầu chia sẻ."
        }
        action={
          doctorView && mode !== "simulation" ? (
            <button className="button primary" onClick={() => setCreate(true)}>
              <Icon name="plus" />
              Tạo tài liệu
            </button>
          ) : (
            <a className="button light" href="#/sharing">
              <Icon name="shield" />
              Quản lý chia sẻ
            </a>
          )
        }
      />
      <div className="privacy-notice">
        <Icon name="lock" />
        <div>
          <strong>Truy cập tài liệu và giải mã là hai bước khác nhau</strong>
          <p>
            Có metadata hoặc ciphertext không có nghĩa đã đọc được bệnh án. Tide
            cần chấp nhận policy đúng hồ sơ để giải mã.
          </p>
        </div>
        <Badge color="blue">TIDE</Badge>
      </div>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorBox error={resource.error} retry={resource.reload} />
      ) : resource.value?.items.length ? (
        <>
          <div className="medical-record-grid">
            {resource.value.items.map((record) => (
              <article className="medical-record-card" key={record.id}>
                <div className="section-heading">
                  <span className="record-icon blue">
                    <Icon name="file" />
                  </span>
                  <Badge color={record.state === "DRAFT" ? "gray" : "blue"}>
                    {record.state === "DRAFT" ? "Bản nháp" : "Đã công bố"}
                  </Badge>
                </div>
                <span className="record-type">{kindLabel(record.kind)}</span>
                <h3>{record.title}</h3>
                <p>
                  <Icon name="calendar" />
                  {dateText(record.createdAt, true)}
                </p>
                <p>
                  <Icon name="lock" />
                  {record.ciphertext
                    ? "Có ciphertext · Chưa giải mã"
                    : "Chờ mã hóa phía trình duyệt"}
                </p>
                <div className="record-card-actions">
                  <button
                    className="button light full"
                    onClick={() => setDetail(record)}
                  >
                    Xem tài liệu
                    <Icon name="arrow" />
                  </button>
                </div>
              </article>
            ))}
          </div>
          <Pager
            offset={offset}
            count={resource.value.items.length}
            onChange={setOffset}
          />
        </>
      ) : (
        <Empty
          icon="file"
          title="Chưa có hồ sơ để hiển thị"
          text={
            doctorView
              ? "Tạo tài liệu khi lượt khám đã bắt đầu hoặc hoàn tất."
              : "Kết quả đã được bác sĩ công bố sẽ xuất hiện tại đây."
          }
        />
      )}
      <Notice>
        {mode === "simulation"
          ? "Bản mô phỏng dùng tài liệu mẫu được mã hóa tại máy chủ. Đây không phải E2EE hoặc thực thi policy trên mạng Tide thật."
          : "Nhãn tài liệu chỉ dùng thông tin trung tính. Nội dung y tế được xử lý trong trình duyệt, không gửi dạng văn bản rõ đến API."}
      </Notice>
      {detail && (
        <RecordDetail
          record={detail}
          doctorView={doctorView}
          onClose={() => setDetail(null)}
          updated={(value) => {
            setDetail(value);
            resource.reload();
          }}
          notify={notify}
        />
      )}
      {create && (
        <NewRecord
          onClose={() => setCreate(false)}
          created={(value) => {
            setCreate(false);
            resource.reload();
            setDetail(value);
          }}
        />
      )}
    </>
  );
}
const kindLabel = (kind: MedicalRecord["kind"]) =>
  ({
    RESULT: "Kết quả khám",
    INSTRUCTION: "Hướng dẫn chăm sóc",
    PATIENT_DOCUMENT: "Tài liệu bệnh nhân",
  })[kind];

function RecordDetail({
  record,
  doctorView,
  onClose,
  updated,
  notify,
}: {
  record: MedicalRecord;
  doctorView: boolean;
  onClose: () => void;
  updated: (record: MedicalRecord) => void;
  notify: (message: string) => void;
}) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [policyId, setPolicyId] = useState("");
  const policies = useResource(
    () =>
      session.mode === "simulation"
        ? Promise.resolve<Policies>({
            recordId: record.id,
            tags: [record.id],
            policies: [],
            verification: "SIMULATED",
          })
        : session.api.policies(record.id),
    [session.api, record.id, record.version],
  );
  async function run(operation: "decrypt" | "encrypt" | "release") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (operation === "decrypt" && session.mode === "simulation") {
        const result = await session.api.simDecrypt(record.id);
        setPlaintext(result.plaintext);
        return;
      }
      if (operation === "release") {
        updated(await session.api.releaseRecord(record.id, record.version));
        notify(
          "Máy chủ đã công bố tài liệu. Hiệu lực mật mã vẫn cần được Tide kiểm chứng.",
        );
        return;
      }
      // Fetch policy again for every operation; never infer decryption rights from cached metadata.
      const current: Policies = await session.api.policies(record.id);
      const policy =
        current.policies.find((value) => value.id === policyId) ||
        current.policies[0];
      if (!policy)
        throw new Error(
          "Chưa có policy phù hợp cho phiên này. Cần hoàn tất policy qua các phiên quản trị Tide độc lập.",
        );
      if (operation === "decrypt") {
        if (!record.ciphertext || !session.decrypt)
          throw new Error("Nội dung hoặc phiên Tide chưa sẵn sàng.");
        setPlaintext(
          await session.decrypt(
            record.id,
            record.ciphertext,
            decodeBase64(policy.policyBytes),
          ),
        );
      } else {
        if (!draft.trim() || !session.encrypt)
          throw new Error("Vui lòng nhập nội dung và kiểm tra phiên Tide.");
        const ciphertext = await session.encrypt(
          record.id,
          draft,
          decodeBase64(policy.policyBytes),
        );
        updated(
          await session.api.recordContent(
            record.id,
            ciphertext,
            record.version,
          ),
        );
        setDraft("");
        notify("Đã gửi ciphertext lên máy chủ. Chưa công bố tài liệu.");
      }
    } catch (reason) {
      setPlaintext(null);
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={record.title}
      subtitle={`${kindLabel(record.kind)} · ${dateText(record.createdAt, true)}`}
      onClose={busy ? () => {} : onClose}
      wide
      footer={
        <>
          <button className="button ghost" disabled={busy} onClick={onClose}>
            Đóng
          </button>
          {record.ciphertext && (
            <button
              className="button primary"
              disabled={
                busy ||
                (session.mode !== "simulation" &&
                  (!policies.value?.policies.length || !session.decrypt))
              }
              onClick={() => run("decrypt")}
            >
              <Icon name="lock" />
              {busy
                ? "Đang xử lý…"
                : session.mode === "simulation"
                  ? "Kiểm tra và mở hồ sơ"
                  : "Giải mã bằng Tide"}
            </button>
          )}
        </>
      }
    >
      <div className="record-meta-line">
        <Badge color="blue">
          {record.state === "DRAFT" ? "Bản nháp" : "Đã công bố"}
        </Badge>
        <Badge color="gray">
          {session.mode === "simulation"
            ? "Policy mô phỏng"
            : "Cần xác minh trên Tide"}
        </Badge>
      </div>
      {Boolean(error) && <ErrorBox error={error} />}
      {session.mode === "simulation" ? (
        <SimRecordAccess recordId={record.id} />
      ) : policies.loading ? (
        <Loading label="Đang lấy policy phù hợp…" />
      ) : policies.error ? (
        <ErrorBox error={policies.error} retry={policies.reload} />
      ) : policies.value?.policies.length ? (
        <label className="field-label">
          Policy của phiên hiện tại
          <select
            aria-label="Policy giải mã"
            value={policyId || policies.value.policies[0].id}
            onChange={(event) => {
              setPolicyId(event.target.value);
              setPlaintext(null);
            }}
          >
            {policies.value.policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.subjectType} · {policy.subjectId}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <Notice>
          Chưa có policy phù hợp được trả về cho phiên của bạn. API không tự cấp
          quyền giải mã.
        </Notice>
      )}
      {plaintext !== null ? (
        <section className="decrypted-record">
          <div className="section-heading">
            <h3>
              {session.mode === "simulation"
                ? "Nội dung mô phỏng · Đã kiểm tra quyền"
                : "Nội dung vừa được Tide giải mã"}
            </h3>
            <button className="text-button" onClick={() => setPlaintext(null)}>
              Ẩn nội dung
            </button>
          </div>
          <pre>{plaintext}</pre>
          <small>
            Nội dung chỉ nằm trong bộ nhớ của trang này và được xóa khi đóng tài
            liệu.
          </small>
        </section>
      ) : (
        <div className="encrypted-placeholder">
          <span>
            <Icon name="lock" />
          </span>
          <h3>
            {record.ciphertext
              ? "Nội dung đang được mã hóa"
              : "Tài liệu đang chờ mã hóa"}
          </h3>
          <p>
            {record.ciphertext
              ? "Nhấn giải mã để gửi yêu cầu qua phiên Tide của chính bạn."
              : "Người tạo cần hoàn tất policy và mã hóa nội dung trong trình duyệt."}
          </p>
        </div>
      )}
      {doctorView &&
        session.mode !== "simulation" &&
        record.state === "DRAFT" && (
          <section className="draft-editor">
            <h3>Chuẩn bị tài liệu mã hóa</h3>
            <p>
              Policy cần được ký từ các phiên admin độc lập trước khi thao tác.
            </p>
            <label className="field-label">
              Nội dung (chỉ nằm trong trình duyệt)
              <textarea
                aria-label="Nội dung tài liệu"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={5}
                maxLength={50000}
                placeholder="Nhập nội dung để gửi trực tiếp qua SDK Tide…"
              />
            </label>
            <div className="draft-actions">
              <button
                className="button light"
                disabled={
                  busy || !draft.trim() || !policies.value?.policies.length
                }
                onClick={() => run("encrypt")}
              >
                <Icon name="lock" />
                Mã hóa và lưu ciphertext
              </button>
              <button
                className="button primary"
                disabled={busy || !record.ciphertext}
                onClick={() => run("release")}
              >
                Công bố tài liệu
                <Icon name="arrow" />
              </button>
            </div>
          </section>
        )}
      <Notice>
        Công bố hoặc import policy không chứng minh quorum đã đạt. Quyền giải mã
        thực tế do mạng Tide quyết định.
      </Notice>
    </Modal>
  );
}

function NewRecord({
  onClose,
  created,
}: {
  onClose: () => void;
  created: (record: MedicalRecord) => void;
}) {
  const session = useSession();
  const visits = useResource(() => session.api.appointments(), [session.api]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      created(
        await session.api.draftRecord(
          String(data.get("appointmentId")),
          String(data.get("title")).trim(),
          String(data.get("kind")) as MedicalRecord["kind"],
        ),
      );
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  const eligible =
    visits.value?.items.filter((item) =>
      ["IN_PROGRESS", "COMPLETED"].includes(item.status),
    ) || [];
  return (
    <Modal
      title="Tạo bản nháp tài liệu"
      subtitle="Chỉ tạo metadata trung tính. Nội dung sẽ được mã hóa ở bước tiếp theo."
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="button ghost" disabled={busy} onClick={onClose}>
            Đóng
          </button>
          <button
            form="draft-form"
            className="button primary"
            disabled={busy || !eligible.length}
          >
            Tạo bản nháp
            <Icon name="plus" />
          </button>
        </>
      }
    >
      {Boolean(error) && <ErrorBox error={error} />}
      {visits.loading ? (
        <Loading />
      ) : visits.error ? (
        <ErrorBox error={visits.error} retry={visits.reload} />
      ) : !eligible.length ? (
        <Notice>
          Chưa có lượt khám đang diễn ra hoặc đã hoàn thành để tạo tài liệu.
        </Notice>
      ) : (
        <form id="draft-form" onSubmit={submit} className="stack-form">
          <label className="field-label">
            Lượt khám
            <select name="appointmentId" required>
              {eligible.map((item) => (
                <option key={item.id} value={item.id}>
                  {dateText(item.startsAt, true)} · {item.serviceName} ·{" "}
                  {item.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Nhãn tài liệu (không chứa chẩn đoán)
            <input
              name="title"
              required
              maxLength={120}
              placeholder="Ví dụ: Tài liệu lượt khám"
            />
          </label>
          <label className="field-label">
            Loại tài liệu
            <select name="kind">
              <option value="RESULT">Kết quả khám</option>
              <option value="INSTRUCTION">Hướng dẫn chăm sóc</option>
            </select>
          </label>
        </form>
      )}
    </Modal>
  );
}

function SharingPage({ catalog, notify }: Props) {
  const session = useSession();
  const resource = useResource(() => session.api.sharing(), [session.api]);
  const [target, setTarget] = useState<Sharing["items"][number] | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [intent, setIntent] = useState<"GRANT" | "REVOKE">("GRANT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || busy || !doctorId) return;
    setBusy(true);
    setError(null);
    try {
      await session.api.accessIntent(target.recordId, doctorId, intent);
      setTarget(null);
      resource.reload();
      notify(
        "Đã ghi nhận yêu cầu. Chờ Tide xử lý; hiệu lực quyền chưa được xác minh.",
      );
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="CHỦ ĐỘNG VỚI DỮ LIỆU CỦA BẠN"
        title="Quyền riêng tư"
        text="Theo dõi ý định chia sẻ và yêu cầu thu hồi đối với từng tài liệu."
      />
      <div className="privacy-notice">
        <Icon name="shield" />
        <div>
          <strong>Yêu cầu của bạn, được theo dõi rõ ràng</strong>
          <p>
            Gửi yêu cầu không tự cấp hoặc thu hồi quyền. Hiệu lực cần được kiểm
            chứng tại Tide sau khi hoàn tất chính sách quản trị.
          </p>
        </div>
        <Badge color="gray">
          {session.mode === "simulation" ? "QUORUM MÔ PHỎNG" : "CHƯA XÁC MINH"}
        </Badge>
      </div>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorBox error={resource.error} retry={resource.reload} />
      ) : resource.value?.items.length ? (
        <div className="sharing-list">
          {resource.value.items.map((item) => (
            <section className="panel sharing-card" key={item.recordId}>
              <div className="section-heading">
                <div>
                  <span className="record-type">TÀI LIỆU ĐÃ CÔNG BỐ</span>
                  <h2>{item.title}</h2>
                </div>
                <Badge color="gray">
                  {session.mode === "simulation"
                    ? "Quorum 2/3 · Mô phỏng"
                    : "Quyền chưa xác minh"}
                </Badge>
              </div>
              {session.mode === "simulation" ? (
                <SharingProgress
                  recordId={item.recordId}
                  revision={item.requests.length}
                />
              ) : (
                <div className="sharing-requests">
                  {item.requests.length ? (
                    item.requests.map((request) => (
                      <div className="sharing-request" key={request.id}>
                        <span className="record-icon purple">
                          <Icon name="clock" />
                        </span>
                        <div>
                          <strong>
                            {request.intent === "GRANT"
                              ? "Yêu cầu chia sẻ"
                              : "Yêu cầu thu hồi"}{" "}
                            ·{" "}
                            {catalog.doctors.find(
                              (doctor) => doctor.id === request.doctorId,
                            )?.displayName || request.doctorId}
                          </strong>
                          <small>
                            {request.createdAt
                              ? dateText(request.createdAt, true)
                              : ""}{" "}
                            · Chờ Tide xử lý
                          </small>
                        </div>
                        <Badge color="blue">PENDING_TIDE</Badge>
                      </div>
                    ))
                  ) : (
                    <p className="inline-hint">
                      Chưa có yêu cầu chia sẻ cho tài liệu này.
                    </p>
                  )}
                </div>
              )}
              <button
                className="button light small"
                onClick={() => {
                  setTarget(item);
                  setDoctorId("");
                  setError(null);
                }}
              >
                Gửi yêu cầu
                <Icon name="arrow" />
              </button>
            </section>
          ))}
        </div>
      ) : (
        <Empty
          icon="shield"
          title="Chưa có tài liệu đã công bố"
          text="Bạn có thể gửi yêu cầu chia sẻ khi kết quả được công bố."
        />
      )}
      <Notice>
        Thu hồi sau khi Tide xác nhận không thể thu hồi văn bản rõ mà người nhận
        đã tải trước đó.
      </Notice>
      {target && (
        <Modal
          title="Yêu cầu thay đổi quyền truy cập"
          subtitle={target.title}
          onClose={busy ? () => {} : () => setTarget(null)}
          footer={
            <>
              <button
                className="button ghost"
                disabled={busy}
                onClick={() => setTarget(null)}
              >
                Đóng
              </button>
              <button
                form="sharing-form"
                className="button primary"
                disabled={busy || !doctorId}
              >
                {busy ? "Đang gửi…" : "Gửi yêu cầu"}
                <Icon name="arrow" />
              </button>
            </>
          }
        >
          {Boolean(error) && <ErrorBox error={error} />}
          <form id="sharing-form" className="stack-form" onSubmit={submit}>
            <label className="field-label">
              Bác sĩ
              <select
                aria-label="Bác sĩ nhận yêu cầu"
                value={doctorId}
                onChange={(event) => setDoctorId(event.target.value)}
                required
              >
                <option value="">Chọn bác sĩ</option>
                {catalog.doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Yêu cầu
              <select
                aria-label="Loại yêu cầu chia sẻ"
                value={intent}
                onChange={(event) =>
                  setIntent(event.target.value as "GRANT" | "REVOKE")
                }
              >
                <option value="GRANT">Yêu cầu chia sẻ tài liệu</option>
                <option value="REVOKE">Yêu cầu thu hồi quyền</option>
              </select>
            </label>
            <Notice>
              Yêu cầu chia sẻ cần quan hệ chăm sóc hợp lệ. Máy chủ sẽ kiểm tra
              khi gửi và chỉ ghi nhận trạng thái chờ Tide.
            </Notice>
          </form>
        </Modal>
      )}
    </>
  );
}

function Visits({ book }: Props) {
  const { api } = useSession();
  const [offset, setOffset] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const resource = useResource(() => api.visits(offset), [api, offset]);
  const follows = useResource(() => api.followUps(), [api]);
  return (
    <>
      <Heading
        eyebrow="HÀNH TRÌNH CHĂM SÓC CỦA BẠN"
        title="Lịch sử khám"
        text="Xem lại lượt khám và chủ động chọn lịch tái khám theo đề nghị của bác sĩ."
      />
      {follows.loading ? (
        <Loading label="Đang tải đề nghị tái khám…" />
      ) : follows.error ? (
        <ErrorBox error={follows.error} retry={follows.reload} />
      ) : (
        (follows.value || [])
          .filter((item) => !item.bookedAppointmentId)
          .map((item) => (
            <section className="follow-up-card" key={item.id}>
              <span className="stat-icon mint">
                <Icon name="calendar" />
              </span>
              <div>
                <h3>Bạn có đề nghị tái khám</h3>
                <p>
                  Khoảng ngày {dateText(item.from, true)} –{" "}
                  {dateText(item.to, true)}. Bạn chủ động chọn giờ và xác nhận.
                </p>
              </div>
              <button
                className="button light small"
                onClick={() => book({ followUp: item })}
              >
                Chọn lịch tái khám
                <Icon name="arrow" />
              </button>
            </section>
          ))
      )}
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorBox error={resource.error} retry={resource.reload} />
      ) : resource.value?.items.length ? (
        <>
          <div className="visits-list">
            {resource.value.items.map((item) => (
              <article className="panel visit-card" key={item.id}>
                <div className="section-heading">
                  <span>
                    <Icon name="calendar" />
                    {dateText(item.startsAt, true)}
                  </span>
                  <Badge>{statusLabels[item.status]}</Badge>
                </div>
                <h2>{item.serviceName}</h2>
                <p>
                  {item.doctorName} · {item.clinic.name}
                </p>
                <div className="visit-card-bottom">
                  <span>
                    <Icon name="file" />
                    {item.records.length} tài liệu đã công bố
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setDetailId(item.id)}
                  >
                    Chi tiết lượt khám
                    <Icon name="arrow" />
                  </button>
                </div>
              </article>
            ))}
          </div>
          <Pager
            offset={offset}
            count={resource.value.items.length}
            onChange={setOffset}
          />
        </>
      ) : (
        <Empty
          icon="activity"
          title="Chưa có lượt khám trong lịch sử"
          text="Các lượt khám đang diễn ra và đã hoàn tất sẽ hiển thị tại đây."
        />
      )}
      {detailId && (
        <VisitDetail id={detailId} onClose={() => setDetailId(null)} />
      )}
    </>
  );
}
function VisitDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { api } = useSession();
  const resource = useResource(() => api.visit(id), [api, id]);
  const value: Visit | null = resource.value;
  return (
    <Modal
      title="Chi tiết lượt khám"
      onClose={onClose}
      footer={
        <button className="button light" onClick={onClose}>
          Đóng
        </button>
      }
    >
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorBox error={resource.error} retry={resource.reload} />
      ) : (
        value && (
          <>
            <div className="booking-doctor">
              <Avatar name={value.doctorName} size="medium" />
              <div>
                <h3>{value.doctorName}</h3>
                <p>
                  {value.serviceName} · {dateText(value.startsAt, true)}
                </p>
              </div>
            </div>
            <h3 className="modal-section-title">Tài liệu đã công bố</h3>
            {value.records.length ? (
              value.records.map((record) => (
                <div key={record.id} className="visit-record">
                  <Icon name="file" />
                  <div>
                    <strong>{record.title}</strong>
                    <small>
                      {kindLabel(record.kind)} ·{" "}
                      {record.ciphertext
                        ? "Đã có ciphertext"
                        : "Chưa có nội dung"}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <p className="inline-hint">
                Chưa có tài liệu đã công bố cho lượt khám này.
              </p>
            )}
            {value.followUp && (
              <Notice>
                Khoảng tái khám do bác sĩ đề nghị:{" "}
                {dateText(value.followUp.fromMs, true)} –{" "}
                {dateText(value.followUp.toMs, true)}.
              </Notice>
            )}
            <a className="text-button" href="#/records" onClick={onClose}>
              Đến hồ sơ sức khỏe
              <Icon name="arrow" />
            </a>
          </>
        )
      )}
    </Modal>
  );
}

function Profile({
  catalog,
  notify,
}: {
  catalog: Catalog;
  notify: (message: string) => void;
}) {
  const session = useSession();
  const me = session.me!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const onboard = me.onboardingRequired;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("displayName")).trim();
    if (!name) return;
    const body = {
      displayName: name,
      ...(data.get("email") ? { email: String(data.get("email")).trim() } : {}),
      ...(data.get("phone") ? { phone: String(data.get("phone")).trim() } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      if (onboard)
        await session.api.onboard({
          ...body,
          clinicId: String(data.get("clinicId")),
          ...(data.get("dateOfBirth")
            ? { dateOfBirth: String(data.get("dateOfBirth")) }
            : {}),
        });
      else await session.api.patchProfile(body);
      await session.reloadMe();
      notify(
        onboard ? "Đã tạo hồ sơ bệnh nhân." : "Đã lưu thông tin tài khoản.",
      );
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  if (onboard && !hasRole(me, "patient"))
    return (
      <Empty
        icon="users"
        title="Tài khoản cần được liên kết"
        text="Tài khoản nhân viên cần được operator liên kết với danh tính Tide trước khi sử dụng."
      >
        <button
          className="button light"
          onClick={() =>
            session.logout().catch((reason) => notify(errorMessage(reason)))
          }
        >
          Đăng xuất
        </button>
      </Empty>
    );
  return (
    <>
      <Heading
        eyebrow={onboard ? "CHÀO MỪNG BẠN ĐẾN CAREFLOW" : "MỘT CHÚT VỀ BẠN"}
        title={onboard ? "Hoàn tất hồ sơ bệnh nhân" : "Thông tin cá nhân"}
        text="Thông tin cần thiết để kết nối với phòng khám và quản lý lịch hẹn."
      />
      <div className="profile-layout">
        <section className="panel profile-form-card">
          <div className="profile-form-header">
            <span className="patient-avatar large">
              {initials(me.displayName || "Bạn")}
            </span>
            <div>
              <h2>{me.displayName || "Hồ sơ của bạn"}</h2>
              <p>
                {onboard
                  ? "Liên kết với danh tính Tide đã đăng nhập"
                  : "Vai trò được xác minh bởi máy chủ"}
              </p>
            </div>
            <Badge color="blue">TIDE</Badge>
          </div>
          {Boolean(error) && <ErrorBox error={error} />}
          <form onSubmit={submit}>
            <div className="form-grid">
              <label className="span-2">
                Họ và tên
                <input
                  name="displayName"
                  defaultValue={me.displayName || ""}
                  required
                  maxLength={120}
                  autoComplete="name"
                />
              </label>
              <label>
                Số điện thoại (tùy chọn)
                <input
                  name="phone"
                  type="tel"
                  defaultValue={me.phone || ""}
                  pattern="\+?[0-9 ()\-]{7,25}"
                  autoComplete="tel"
                />
              </label>
              <label>
                Email (tùy chọn)
                <input
                  name="email"
                  type="email"
                  defaultValue={me.email || ""}
                  maxLength={254}
                  autoComplete="email"
                />
              </label>
              {onboard && (
                <>
                  <label>
                    Phòng khám
                    <select name="clinicId" required>
                      <option value="">Chọn phòng khám</option>
                      {catalog.clinics.map((clinic) => (
                        <option key={clinic.id} value={clinic.id}>
                          {clinic.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ngày sinh (tùy chọn)
                    <input name="dateOfBirth" type="date" autoComplete="bday" />
                  </label>
                </>
              )}
            </div>
            <div className="profile-save-row">
              <span>
                <Icon name="shield" />
                Không yêu cầu mật khẩu Tide tại đây
              </span>
              <button className="button primary" disabled={busy}>
                {busy
                  ? "Đang lưu…"
                  : onboard
                    ? "Tạo hồ sơ bệnh nhân"
                    : "Lưu thay đổi"}
                <Icon name="check" />
              </button>
            </div>
          </form>
        </section>
        <aside>
          <div className="privacy-notice vertical">
            <Icon name="shield" />
            <strong>Bạn kiểm soát thông tin của mình</strong>
            <p>
              Vai trò tài khoản không thể thay đổi qua trang này. CareFlow không
              lưu token hoặc bệnh án vào localStorage.
            </p>
          </div>
          <section className="panel reset-card">
            <h3>Kết thúc phiên làm việc</h3>
            <p>
              Đăng xuất để đóng phiên và xóa dữ liệu cá nhân khỏi bộ nhớ giao
              diện.
            </p>
            <button
              className="button ghost full"
              disabled={busy}
              onClick={() =>
                session.logout().catch((reason) => notify(errorMessage(reason)))
              }
            >
              <Icon name="logout" />
              Đăng xuất khỏi Tide
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}

function Notifications({ notify }: { notify: (message: string) => void }) {
  const { api } = useSession();
  const [offset, setOffset] = useState(0);
  const [busyId, setBusyId] = useState("");
  const resource = useResource(() => api.notifications(offset), [api, offset]);
  const kind = (item: Notification) =>
    item.kind === "REMINDER"
      ? "Nhắc lịch khám"
      : item.kind === "APPOINTMENT_DISRUPTED"
        ? "Lịch khám cần xử lý"
        : "Cập nhật lịch hẹn";
  async function mark(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      await api.readNotification(id);
      resource.reload();
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setBusyId("");
    }
  }
  return (
    <>
      <Heading
        eyebrow="LUÔN CẬP NHẬT CÙNG BẠN"
        title="Thông báo"
        text="Những thay đổi và nhắc hẹn liên quan đến tài khoản của bạn."
      />
      <Notice>
        Thông báo trong ứng dụng được mô phỏng (SIMULATED). Chưa gửi SMS hoặc
        email thật.
      </Notice>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorBox error={resource.error} retry={resource.reload} />
      ) : resource.value?.items.length ? (
        <>
          <div className="notification-cards">
            {resource.value.items.map((item) => (
              <article
                className={`panel notification-card ${!item.readAt ? "unread" : ""}`}
                key={item.id}
              >
                <span className="stat-icon blue">
                  <Icon name="bell" />
                </span>
                <div>
                  <h3>{kind(item)}</h3>
                  <p>
                    Lịch hẹn {item.appointmentId.slice(0, 8)} ·{" "}
                    {dateText(item.createdAt, true)}
                  </p>
                  <Badge color="gray">SIMULATED</Badge>
                </div>
                {!item.readAt && (
                  <button
                    className="text-button"
                    disabled={Boolean(busyId)}
                    onClick={() => mark(item.id)}
                  >
                    {busyId === item.id ? "Đang cập nhật…" : "Đánh dấu đã đọc"}
                  </button>
                )}
              </article>
            ))}
          </div>
          <Pager
            offset={offset}
            count={resource.value.items.length}
            onChange={setOffset}
          />
        </>
      ) : (
        <Empty
          icon="bell"
          title="Chưa có thông báo mới"
          text="Các cập nhật liên quan đến lịch hẹn sẽ hiển thị tại đây."
        />
      )}
    </>
  );
}
