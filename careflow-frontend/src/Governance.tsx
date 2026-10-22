import { useState } from "react";
import { useSession } from "./session-context";
import { dateText, timeText } from "./utils";
import type { SimApproval } from "./types";
import { EmergencyApprovals, EmergencyPanel } from "./Emergency";
import {
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

export function RequestProgress({ request }: { request: SimApproval }) {
  return (
    <div className="quorum-request">
      <div className="section-heading">
        <div>
          <strong>
            {request.intent === "GRANT" ? "Chia sẻ với" : "Thu hồi quyền của"}{" "}
            {request.doctorName}
          </strong>
          <p>{dateText(request.createdAt, true)}</p>
        </div>
        <Badge color={request.status === "COMMITTED" ? "green" : "blue"}>
          {request.status === "COMMITTED"
            ? "Đã thực thi · Mô phỏng"
            : "Chờ phê duyệt"}
        </Badge>
      </div>
      <div className="quorum-progress">
        <div>
          <span
            style={{
              width: `${Math.min(100, (request.approvals.length / request.quorum.threshold) * 100)}%`,
            }}
          />
        </div>
        <strong>
          {request.approvals.length}/{request.quorum.threshold} phiếu độc lập
        </strong>
      </div>
      <div className="quorum-signers">
        {request.approvals.length ? (
          request.approvals.map((approval) => (
            <span key={approval.adminId}>
              <Icon name="check" />
              {approval.displayName}
            </span>
          ))
        ) : (
          <span>Chưa có admin phê duyệt.</span>
        )}
      </div>
    </div>
  );
}
export function SharingProgress({
  recordId,
  revision = 0,
}: {
  recordId: string;
  revision?: number;
}) {
  const session = useSession();
  const [showHistory, setShowHistory] = useState(false);
  const resource = useResource(
    () => session.api.simAccess(recordId),
    [session.api, recordId, revision],
  );
  return (
    <div className="sim-sharing-progress">
      {resource.value && !resource.loading && !resource.error && (
        <EmergencyPanel
          recordId={recordId}
          access={resource.value}
          refresh={resource.reload}
        />
      )}
      {resource.loading ? (
        <Loading label="Đang tải trạng thái quorum…" />
      ) : resource.error ? (
        <ErrorBox error={resource.error} retry={resource.reload} />
      ) : resource.value?.requests.length ? (
        resource.value.requests.map((request) => (
          <RequestProgress key={request.id} request={request} />
        ))
      ) : (
        <p className="inline-hint">
          Chưa có yêu cầu. Quyền thay đổi sau khi đủ 2 admin độc lập phê duyệt.
        </p>
      )}
      <button className="text-button" onClick={resource.reload}>
        <Icon name="refresh" />
        Cập nhật trạng thái
      </button>
      <button
        className="text-button access-log-button"
        onClick={() => setShowHistory((old) => !old)}
      >
        <Icon name="activity" />
        {showHistory ? "Ẩn lịch sử truy cập" : "Xem lịch sử truy cập"}
      </button>
      {showHistory && <AccessHistory recordId={recordId} />}
    </div>
  );
}
function AccessHistory({ recordId }: { recordId: string }) {
  const { api } = useSession();
  const resource = useResource(
    () => api.simAccessLog(recordId),
    [api, recordId],
  );
  const labels: Record<string, string> = {
    ACCESS_INTENT_SUBMITTED: "Gửi yêu cầu thay đổi quyền",
    SIM_TIDE_APPROVAL: "Phê duyệt một phiếu",
    SIM_TIDE_QUORUM_COMMITTED: "Đủ quorum · Thực thi mô phỏng",
    SIM_TIDE_DECRYPT: "Được phép mở hồ sơ",
    SIM_TIDE_DECRYPT_DENIED: "Bị từ chối mở hồ sơ",
    SIM_EMERGENCY_REQUESTED: "Gửi yêu cầu truy cập khẩn cấp",
    SIM_EMERGENCY_APPROVAL: "Phê duyệt khẩn cấp · Một phiếu",
    SIM_EMERGENCY_COMMITTED: "Đủ quorum · Quyền khẩn cấp 60 phút",
    SIM_EMERGENCY_ENDED: "Đã kết thúc quyền khẩn cấp",
  };
  return (
    <section className="access-history" aria-label="Lịch sử truy cập hồ sơ">
      <div className="section-heading">
        <h3>Lịch sử truy cập</h3>
        <button className="text-button" onClick={resource.reload}>
          <Icon name="refresh" />
          Cập nhật
        </button>
      </div>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorBox error={resource.error} retry={resource.reload} />
      ) : resource.value?.items.length ? (
        resource.value.items.map((item, index) => (
          <div
            className={`access-event ${item.action.endsWith("DENIED") ? "denied" : ""}`}
            key={`${item.actorId}-${item.at}-${index}`}
          >
            <span>
              <Icon
                name={
                  item.action.endsWith("DENIED")
                    ? "lock"
                    : item.action === "SIM_TIDE_APPROVAL"
                      ? "check"
                      : "shield"
                }
              />
            </span>
            <div>
              <strong>
                {labels[item.action] || "Cập nhật quyền truy cập"}
              </strong>
              <p>{item.actorName}</p>
              {item.details?.reason && <p>{item.details.reason}</p>}
            </div>
            <time dateTime={item.at}>
              {timeText(item.at)}
              <small>{dateText(item.at)}</small>
            </time>
          </div>
        ))
      ) : (
        <p className="inline-hint">Chưa có hoạt động trên tài liệu này.</p>
      )}
    </section>
  );
}
export function SimRecordAccess({ recordId }: { recordId: string }) {
  const { api } = useSession();
  const resource = useResource(() => api.simAccess(recordId), [api, recordId]);
  return resource.loading ? (
    <Loading label="Đang kiểm tra policy mô phỏng…" />
  ) : resource.error ? (
    <ErrorBox error={resource.error} retry={resource.reload} />
  ) : (
    <>
      <div
        className={`sim-record-access ${resource.value?.canDecrypt ? "allowed" : "denied"}`}
      >
        <Icon name={resource.value?.canDecrypt ? "shield" : "lock"} />
        <div>
          <strong>
            {resource.value?.canDecrypt
              ? "Policy mô phỏng cho phép tài khoản này"
              : "Chưa có quyền đọc nội dung hồ sơ"}
          </strong>
          <p>
            {resource.value?.canDecrypt
              ? "Nội dung chỉ được tải sau khi máy chủ kiểm tra lại yêu cầu mở."
              : "Có phân công khám không tự cấp quyền. Cần bệnh nhân yêu cầu chia sẻ và đủ 2 admin độc lập phê duyệt."}
          </p>
        </div>
      </div>
      {resource.value && (
        <EmergencyPanel
          recordId={recordId}
          access={resource.value}
          refresh={resource.reload}
        />
      )}
    </>
  );
}
export default function Governance({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const session = useSession();
  const [target, setTarget] = useState<SimApproval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const resource = useResource(() => session.api.simApprovals(), [session.api]);
  async function approve() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await session.api.simApprove(target.id);
      setTarget(null);
      resource.reload();
      notify(
        result.quorum.reached
          ? "Đã đủ quorum. Máy chủ đã thực thi thay đổi trong chế độ mô phỏng."
          : "Đã ghi nhận một phiếu. Cần một admin độc lập khác; quyền chưa thay đổi.",
      );
    } catch (reason) {
      setError(reason);
      resource.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="QUẢN TRỊ BẰNG THẨM QUYỀN ĐỘC LẬP"
        title="Phê duyệt quyền truy cập"
        text="Một quản trị viên không thể tự mình mở khóa hồ sơ bệnh nhân."
        action={
          <button className="button light" onClick={resource.reload}>
            <Icon name="refresh" />
            Làm mới
          </button>
        }
      />
      <section className="governance-hero">
        <span className="governance-shield">
          <Icon name="shield" />
        </span>
        <div>
          <span className="eyebrow">EMERGENT AUTHORITY · MÔ PHỎNG</span>
          <h2>
            Hai sự đồng thuận.
            <br />
            Một quyết định có trách nhiệm.
          </h2>
          <p>
            Cần ít nhất 2 trong 3 admin độc lập. Mỗi tài khoản chỉ được phê
            duyệt một lần; admin không có quyền đọc bệnh án chỉ nhờ vai trò quản
            trị.
          </p>
        </div>
        <div className="quorum-number">
          <strong>
            2<span>/3</span>
          </strong>
          <small>ADMIN ĐỘC LẬP</small>
        </div>
      </section>
      {!resource.loading && !resource.error && (
        <EmergencyApprovals
          items={resource.value?.emergencyItems || []}
          refresh={resource.reload}
          notify={notify}
        />
      )}
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorBox error={resource.error} retry={resource.reload} />
      ) : resource.value?.items.length ? (
        <div className="approvals-list">
          {resource.value.items.map((request) => {
            const approved = request.approvals.some(
              (item) => item.adminId === session.me?.id,
            );
            return (
              <section className="panel approval-card" key={request.id}>
                <div className="section-heading">
                  <div>
                    <span className="record-type">YÊU CẦU TỪ BỆNH NHÂN</span>
                    <h2>{request.recordTitle}</h2>
                  </div>
                  <Icon name="file" />
                </div>
                <RequestProgress request={request} />
                <button
                  className={`button ${approved ? "light" : "primary"}`}
                  disabled={approved}
                  onClick={() => {
                    setTarget(request);
                    setError(null);
                  }}
                >
                  <Icon name={approved ? "check" : "shield"} />
                  {approved
                    ? "Bạn đã phê duyệt · Chờ admin khác"
                    : "Xem và phê duyệt"}
                </button>
              </section>
            );
          })}
        </div>
      ) : resource.value?.emergencyItems?.length ? null : (
        <Empty
          icon="shield"
          title="Không có yêu cầu đang chờ"
          text="Các yêu cầu chia sẻ hoặc thu hồi từ bệnh nhân sẽ xuất hiện tại đây."
        />
      )}
      <Notice>
        Đây là quản trị mô phỏng tại API. Trong Tide thật, quorum cần được thực
        thi bởi các phiên quản trị và mạng Tide độc lập.
      </Notice>
      {target && (
        <Modal
          title="Phê duyệt bằng tài khoản hiện tại?"
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
                <Icon name="check" />
                {busy ? "Đang gửi…" : "Xác nhận phê duyệt"}
              </button>
            </>
          }
        >
          {Boolean(error) && <ErrorBox error={error} />}
          <RequestProgress request={target} />
          <Notice>
            Phiếu của bạn chỉ đại diện cho {session.me?.displayName}. Máy chủ sẽ
            kiểm tra trùng phiếu và chỉ thực thi khi đủ ngưỡng.
          </Notice>
        </Modal>
      )}
    </>
  );
}
