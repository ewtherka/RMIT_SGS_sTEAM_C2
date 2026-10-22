import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "./session-context";
import { dateText, hasRole, timeText } from "./utils";
import type { EmergencyRequest, SimAccess } from "./types";
import { Badge, ErrorBox, Icon, Modal, Notice } from "./ui";

const statusText: Record<EmergencyRequest["status"], string> = {
  PENDING_TIDE: "Chờ đủ quorum",
  COMMITTED: "Đang hiệu lực",
  ENDED: "Đã kết thúc",
  EXPIRED: "Đã hết hạn",
};
export function EmergencySummary({ request }: { request: EmergencyRequest }) {
  return (
    <div
      className={`emergency-summary ${request.status === "COMMITTED" ? "active" : ""}`}
    >
      <div className="section-heading">
        <strong>{request.doctorName}</strong>
        <Badge color={request.status === "COMMITTED" ? "green" : "gray"}>
          {statusText[request.status]}
        </Badge>
      </div>
      <blockquote>{request.reason}</blockquote>
      <div className="emergency-meta">
        <span>
          <Icon name="shield" />
          {request.approvals.length}/{request.quorum.threshold} admin độc lập
        </span>
        <span>
          <Icon name="clock" />
          {request.expiresAt
            ? `Hiệu lực đến ${timeText(request.expiresAt)} · ${dateText(request.expiresAt)}`
            : `${request.durationMinutes} phút sau khi đủ quorum`}
        </span>
      </div>
    </div>
  );
}

export function EmergencyPanel({
  recordId,
  access,
  refresh,
}: {
  recordId: string;
  access: SimAccess;
  refresh: () => void;
}) {
  const session = useSession();
  const [requesting, setRequesting] = useState(false);
  const [ending, setEnding] = useState<EmergencyRequest | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const emergencies = access.emergencies || [];
  const current = emergencies.filter((item) =>
    ["PENDING_TIDE", "COMMITTED"].includes(item.status),
  );
  const doctor = hasRole(session.me, "doctor");
  const patient = hasRole(session.me, "patient");
  useEffect(() => {
    if (!current.some((item) => item.status === "COMMITTED")) return;
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [current.some((item) => item.status === "COMMITTED"), refresh]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 10 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.api.requestEmergency(recordId, reason.trim());
      setRequesting(false);
      setReason("");
      refresh();
    } catch (value) {
      setError(value);
    } finally {
      setBusy(false);
    }
  }
  async function end() {
    if (!ending || busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.api.endEmergency(ending.id);
      setEnding(null);
      refresh();
    } catch (value) {
      setError(value);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {current.map((item) => (
        <section
          className={`emergency-panel ${item.status === "COMMITTED" ? "active" : ""}`}
          key={item.id}
        >
          <div className="emergency-label">
            <Icon name="activity" />
            TRUY CẬP KHẨN CẤP · MÔ PHỎNG
          </div>
          <EmergencySummary request={item} />
          {(patient || doctor) && (
            <button
              className="button ghost danger small"
              onClick={() => {
                setEnding(item);
                setError(null);
              }}
            >
              <Icon name="close" />
              {patient ? "Kết thúc ngay" : "Rút yêu cầu khẩn cấp"}
            </button>
          )}
        </section>
      ))}
      {doctor && !access.canDecrypt && current.length === 0 && (
        <div className="emergency-entry">
          <div>
            <strong>Trong tình huống khẩn cấp?</strong>
            <p>
              Vẫn cần lý do và 2 admin độc lập. Quyền chỉ có hiệu lực 60 phút
              trên đúng hồ sơ.
            </p>
          </div>
          <button
            className="button ghost small"
            onClick={() => {
              setRequesting(true);
              setError(null);
            }}
          >
            Yêu cầu truy cập khẩn cấp
            <Icon name="arrow" />
          </button>
        </div>
      )}
      {emergencies.length > current.length && (
        <details className="emergency-past">
          <summary>
            Các yêu cầu khẩn cấp đã kết thúc (
            {emergencies.length - current.length})
          </summary>
          {emergencies
            .filter((item) => !current.includes(item))
            .map((item) => (
              <EmergencySummary key={item.id} request={item} />
            ))}
        </details>
      )}
      {requesting && (
        <Modal
          title="Yêu cầu truy cập khẩn cấp"
          subtitle="Không có master key, kể cả trong tình huống khẩn cấp."
          onClose={busy ? () => {} : () => setRequesting(false)}
          footer={
            <>
              <button
                className="button ghost"
                disabled={busy}
                onClick={() => setRequesting(false)}
              >
                Đóng
              </button>
              <button
                form="emergency-request-form"
                className="button primary"
                disabled={busy || reason.trim().length < 10}
              >
                {busy ? "Đang gửi…" : "Gửi yêu cầu khẩn cấp"}
                <Icon name="arrow" />
              </button>
            </>
          }
        >
          {Boolean(error) && <ErrorBox error={error} />}
          <form id="emergency-request-form" onSubmit={submit}>
            <label className="field-label">
              Lý do truy cập (bệnh nhân và admin sẽ thấy)
              <textarea
                aria-label="Lý do truy cập khẩn cấp"
                required
                minLength={10}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                placeholder="Mô tả lý do minh họa, ít nhất 10 ký tự…"
              />
            </label>
            <small className="reason-count">
              {reason.trim().length}/500 ký tự
            </small>
            <Notice>
              Cần 2/3 admin độc lập phê duyệt. Hiệu lực tối đa 60 phút; bệnh
              nhân có thể kết thúc ngay. Chỉ dùng dữ liệu demo cho bản mô phỏng.
            </Notice>
          </form>
        </Modal>
      )}
      {ending && (
        <Modal
          title="Kết thúc quyền khẩn cấp?"
          subtitle={ending.recordTitle}
          onClose={busy ? () => {} : () => setEnding(null)}
          footer={
            <>
              <button
                className="button ghost"
                disabled={busy}
                onClick={() => setEnding(null)}
              >
                Giữ yêu cầu
              </button>
              <button
                className="button danger-fill"
                disabled={busy}
                onClick={end}
              >
                {busy ? "Đang xử lý…" : "Kết thúc quyền khẩn cấp"}
              </button>
            </>
          }
        >
          {Boolean(error) && <ErrorBox error={error} />}
          <EmergencySummary request={ending} />
          <Notice>
            Các lần mở tiếp theo sẽ được kiểm tra lại. Không thể thu hồi văn bản
            rõ đã được người nhận tải trước đó.
          </Notice>
        </Modal>
      )}
    </>
  );
}

export function EmergencyApprovals({
  items,
  refresh,
  notify,
}: {
  items: EmergencyRequest[];
  refresh: () => void;
  notify: (message: string) => void;
}) {
  const session = useSession();
  const [target, setTarget] = useState<EmergencyRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function approve() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await session.api.approveEmergency(target.id);
      setTarget(null);
      refresh();
      notify(
        result.status === "COMMITTED"
          ? "Đủ quorum. Quyền khẩn cấp mô phỏng có hiệu lực trong 60 phút."
          : "Đã ghi nhận một phiếu. Quyền khẩn cấp chưa có hiệu lực.",
      );
    } catch (value) {
      setError(value);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  if (!items.length) return null;
  return (
    <section className="emergency-approvals">
      <div className="section-heading">
        <div>
          <span className="eyebrow">CẦN XEM XÉT CẨN TRỌNG</span>
          <h2>Yêu cầu truy cập khẩn cấp</h2>
        </div>
        <Badge color="gray">2/3 · 60 phút</Badge>
      </div>
      <div className="approvals-list">
        {items.map((item) => {
          const approved = item.approvals.some(
            (value) => value.adminId === session.me?.id,
          );
          return (
            <article className="panel emergency-approval-card" key={item.id}>
              <h3>{item.recordTitle}</h3>
              <EmergencySummary request={item} />
              <button
                className="button light"
                disabled={approved}
                onClick={() => {
                  setTarget(item);
                  setError(null);
                }}
              >
                <Icon name={approved ? "check" : "shield"} />
                {approved
                  ? "Bạn đã duyệt · Chờ admin độc lập khác"
                  : "Duyệt yêu cầu khẩn cấp"}
              </button>
            </article>
          );
        })}
      </div>
      {target && (
        <Modal
          title="Phê duyệt quyền khẩn cấp?"
          subtitle={target.recordTitle}
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
                className="button primary"
                disabled={busy}
                onClick={approve}
              >
                {busy ? "Đang xử lý…" : "Xác nhận duyệt khẩn cấp"}
                <Icon name="check" />
              </button>
            </>
          }
        >
          {Boolean(error) && <ErrorBox error={error} />}
          <EmergencySummary request={target} />
          <Notice>
            Bạn chỉ đại diện cho {session.me?.displayName}. Một phiếu không cấp
            quyền. Bệnh nhân có thể kết thúc quyền sau khi đủ quorum.
          </Notice>
        </Modal>
      )}
    </section>
  );
}
