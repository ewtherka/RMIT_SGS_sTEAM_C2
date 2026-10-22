import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { useSession } from "./session-context";
import type { Appointment, Doctor, FollowUp, Service, Slot } from "./types";
import { addDays, dateText, money, timeText, today, weekday } from "./utils";
import {
  Avatar,
  Badge,
  ErrorBox,
  Icon,
  Loading,
  Modal,
  Notice,
  useResource,
} from "./ui";

export interface BookingSelection {
  doctorId?: string;
  serviceId?: string;
  existing?: Appointment;
  followUp?: FollowUp;
}
export function Booking({
  selection,
  services,
  doctors,
  onClose,
  onBooked,
}: {
  selection: BookingSelection;
  services: Service[];
  doctors: Doctor[];
  onClose: () => void;
  onBooked: () => void;
}) {
  const session = useSession();
  const [serviceId, setServiceId] = useState(
    selection.existing?.serviceId ||
      selection.followUp?.serviceId ||
      selection.serviceId ||
      services[0]?.id ||
      "",
  );
  const [doctorId, setDoctorId] = useState(
    selection.doctorId ||
      selection.existing?.doctorId ||
      selection.followUp?.preferredDoctorId ||
      "",
  );
  const [date, setDate] = useState(
    selection.followUp && selection.followUp.from > today()
      ? selection.followUp.from
      : addDays(today(), 1),
  );
  const [selected, setSelected] = useState<Slot | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<Appointment | null>(null);
  // Reuse exactly the same body + key after an ambiguous network failure.
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const service = services.find((item) => item.id === serviceId);
  const eligible = useResource(
    () => session.api.doctors(serviceId),
    [session.api, serviceId],
  );
  const slots = useResource(
    () =>
      selection.existing?.disruptionStatus === "ACTION_REQUIRED"
        ? session.api.alternatives(selection.existing.id, date, date)
        : session.api.availability({
            serviceId,
            ...(doctorId ? { doctorId } : {}),
            from: date,
            to: date,
          }),
    [session.api, serviceId, doctorId, date, selection.existing?.id],
  );
  useEffect(() => {
    setSelected(null);
    setError(null);
    attempt.current = null;
  }, [serviceId, doctorId, date]);
  const chooseService = (value: string) => {
    setServiceId(value);
    setDoctorId("");
  };
  const maximumDate = selection.followUp?.to || addDays(today(), 89);
  const minimumDate =
    selection.followUp?.from && selection.followUp.from > today()
      ? selection.followUp.from
      : today();
  const days = Array.from({ length: 6 }, (_, index) =>
    addDays(minimumDate === today() ? addDays(today(), 1) : minimumDate, index),
  ).filter((day) => day <= maximumDate);
  const availableSlots = (slots.value || []).filter(
    (slot) => !doctorId || slot.doctorId === doctorId,
  );
  const selectedDoctor = doctors.find((item) => item.id === selected?.doctorId);

  async function confirm() {
    if (
      !selected ||
      session.status !== "authenticated" ||
      !session.me ||
      session.me.onboardingRequired ||
      busy
    )
      return;
    const body = selection.existing
      ? {
          doctorId: selected.doctorId,
          startsAt: selected.startsAt,
          expectedVersion: selection.existing.version,
        }
      : {
          serviceId,
          doctorId: selected.doctorId,
          startsAt: selected.startsAt,
          ...(selection.followUp ? { followUpId: selection.followUp.id } : {}),
        };
    const fingerprint = JSON.stringify(body);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const result = selection.existing
        ? await session.api.reschedule(
            selection.existing.id,
            body as {
              doctorId: string;
              startsAt: string;
              expectedVersion: number;
            },
            attempt.current.key,
          )
        : await session.api.book(
            body as {
              serviceId: string;
              doctorId: string;
              startsAt: string;
              followUpId?: string;
            },
            attempt.current.key,
          );
      setCreated(result);
      onBooked();
    } catch (reason) {
      setError(reason);
      if (
        reason instanceof ApiError &&
        ["SLOT_UNAVAILABLE", "VERSION_CONFLICT"].includes(reason.code)
      ) {
        setStep(1);
        setSelected(null);
        slots.reload();
        attempt.current = null;
        onBooked();
      }
    } finally {
      setBusy(false);
    }
  }

  const done = () => {
    onClose();
    window.location.hash = "/appointments";
  };
  if (created)
    return (
      <Modal
        title={selection.existing ? "Đã đổi lịch hẹn!" : "Đặt lịch thành công!"}
        subtitle="Một bước nhỏ cho sức khỏe, một ngày thêm an tâm."
        onClose={onClose}
        footer={
          <button className="button primary full" onClick={done}>
            Xem lịch hẹn của tôi
            <Icon name="arrow" />
          </button>
        }
      >
        <div className="booking-success">
          <span className="success-symbol">
            <Icon name="check" />
          </span>
          <h3>{created.doctorName}</h3>
          <p>
            {dateText(created.startsAt, true)} · {timeText(created.startsAt)} –{" "}
            {timeText(created.endsAt)}
          </p>
          <p>{created.clinic.name}</p>
          <span className="booking-reference">Mã lịch hẹn: {created.id}</span>
          <p className="muted">
            Lịch hẹn đã được máy chủ xác nhận.
            <br />
            Đặt lịch không tự cấp quyền xem hồ sơ.
          </p>
        </div>
      </Modal>
    );
  return (
    <Modal
      title={
        selection.existing
          ? "Thay đổi lịch hẹn"
          : selection.followUp
            ? "Đặt lịch tái khám"
            : "Đặt lịch khám"
      }
      subtitle="Chọn thời gian thuận tiện để chăm sóc chính mình."
      wide
      onClose={busy ? () => {} : onClose}
      footer={
        step === 1 ? (
          <>
            <span className="booking-footer-note">
              <Icon name="shield" />
              Không thu phí trên ứng dụng
            </span>
            <button
              className="button primary"
              disabled={!selected || slots.loading}
              onClick={() => setStep(2)}
            >
              Tiếp tục
              <Icon name="arrow" />
            </button>
          </>
        ) : (
          <>
            <button
              className="button ghost"
              disabled={busy}
              onClick={() => setStep(1)}
            >
              <Icon name="back" />
              Quay lại
            </button>
            <button
              className="button primary"
              disabled={busy || !session.me || session.me.onboardingRequired}
              onClick={confirm}
            >
              {busy ? <span className="spinner" /> : <Icon name="check" />}
              {busy ? "Đang xác nhận…" : "Xác nhận lịch hẹn"}
            </button>
          </>
        )
      }
    >
      <div className="booking-progress">
        <span className={step === 1 ? "current" : "done"}>
          <b>{step === 1 ? "1" : "✓"}</b>Chọn lịch khám
        </span>
        <i />
        <span className={step === 2 ? "current" : ""}>
          <b>2</b>Xác nhận
        </span>
      </div>
      {Boolean(error) && <ErrorBox error={error} />}
      {step === 1 ? (
        <>
          <div className="form-grid booking-selectors">
            <label>
              Dịch vụ
              <select
                aria-label="Dịch vụ khám"
                value={serviceId}
                disabled={Boolean(selection.existing || selection.followUp)}
                onChange={(event) => chooseService(event.target.value)}
              >
                {services.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {money(item.feeVnd)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bác sĩ
              <select
                aria-label="Bác sĩ phụ trách"
                value={doctorId}
                onChange={(event) => setDoctorId(event.target.value)}
              >
                <option value="">Tất cả bác sĩ phù hợp</option>
                {(eligible.value || []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {Boolean(eligible.error) && (
            <ErrorBox error={eligible.error} retry={eligible.reload} />
          )}
          <div className="booking-section-label">
            <strong>Chọn ngày khám</strong>
            <label className="custom-date-label">
              Ngày khác
              <input
                aria-label="Ngày khám"
                type="date"
                value={date}
                min={minimumDate}
                max={maximumDate}
                onChange={(event) => {
                  if (event.target.checkValidity() && event.target.value)
                    setDate(event.target.value);
                }}
              />
            </label>
          </div>
          <div className="date-picker">
            {days.map((day) => (
              <button
                key={day}
                className={`date-option ${date === day ? "selected" : ""}`}
                aria-pressed={date === day}
                onClick={() => setDate(day)}
              >
                <span>
                  {weekday(day).replace("Thứ ", "T").replace("Chủ Nhật", "CN")}
                </span>
                <strong>{day.slice(8)}</strong>
                <small>Tháng {Number(day.slice(5, 7))}</small>
              </button>
            ))}
          </div>
          <div className="booking-section-label">
            <strong>Lịch trống từ phòng khám</strong>
            <span className="muted">
              {dateText(date)} · {service?.durationMinutes} phút / lượt
            </span>
          </div>
          {slots.loading ? (
            <Loading label="Đang kiểm tra lịch trống…" />
          ) : slots.error ? (
            <ErrorBox error={slots.error} retry={slots.reload} />
          ) : !availableSlots.length ? (
            <div className="inline-empty">
              <Icon name="calendar" />
              <p>Chưa có giờ trống trong ngày này. Bạn hãy chọn ngày khác.</p>
            </div>
          ) : (
            <div className="slot-groups">
              {Array.from(
                new Set(availableSlots.map((slot) => slot.doctorId)),
              ).map((id) => (
                <div className="slot-group" key={id}>
                  <strong>
                    {
                      availableSlots.find((slot) => slot.doctorId === id)
                        ?.doctorName
                    }
                  </strong>
                  <div className="time-picker">
                    {availableSlots
                      .filter((slot) => slot.doctorId === id)
                      .map((slot) => (
                        <button
                          key={slot.slotId}
                          className={`time-option ${selected?.slotId === slot.slotId ? "selected" : ""}`}
                          aria-pressed={selected?.slotId === slot.slotId}
                          onClick={() => setSelected(slot)}
                        >
                          {timeText(slot.startsAt)}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Notice>
            Giờ khám hiển thị theo Việt Nam (UTC+7). Máy chủ sẽ kiểm tra lại
            khung giờ khi bạn xác nhận.
          </Notice>
        </>
      ) : (
        <>
          {selected && (
            <>
              <div className="booking-doctor">
                <Avatar
                  name={selectedDoctor?.displayName || selected.doctorName}
                  size="medium"
                />
                <div>
                  <h3>{selected.doctorName}</h3>
                  <p>{service?.name}</p>
                </div>
                <strong>{money(selected.feeVnd)}</strong>
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Bệnh nhân</dt>
                  <dd>{session.me?.displayName || "Cần đăng nhập"}</dd>
                </div>
                <div>
                  <dt>Ngày khám</dt>
                  <dd>{dateText(selected.startsAt, true)}</dd>
                </div>
                <div>
                  <dt>Thời gian</dt>
                  <dd>
                    {timeText(selected.startsAt)} – {timeText(selected.endsAt)}
                  </dd>
                </div>
                <div>
                  <dt>Thời lượng</dt>
                  <dd>{selected.durationMinutes} phút</dd>
                </div>
                <div className="total">
                  <dt>Phí khám tham khảo</dt>
                  <dd>{money(selected.feeVnd)}</dd>
                </div>
              </dl>
            </>
          )}
          {session.status !== "authenticated" ? (
            <div className="booking-auth">
              <Icon name="lock" />
              <h3>Đăng nhập để xác nhận lịch hẹn</h3>
              <p>
                {session.status === "unconfigured"
                  ? "Đăng nhập Tide chưa được cấu hình ở máy chủ. Bạn vẫn có thể tra cứu bác sĩ và giờ khám."
                  : "Sử dụng tài khoản Tide của bạn để tiếp tục."}
              </p>
              {session.status === "guest" ? (
                <button
                  className="button primary"
                  onClick={() => {
                    session.login().catch((reason) => setError(reason));
                  }}
                >
                  Đăng nhập bằng Tide
                  <Icon name="arrow" />
                </button>
              ) : (
                <button className="button light" onClick={session.retry}>
                  Kiểm tra lại cấu hình
                  <Icon name="refresh" />
                </button>
              )}
            </div>
          ) : session.me?.onboardingRequired ? (
            <Notice>
              Vui lòng hoàn tất thông tin bệnh nhân ở trang Thông tin cá nhân
              trước khi xác nhận.
            </Notice>
          ) : (
            <Notice>
              Đặt lịch không đồng nghĩa chia sẻ bệnh án. Bạn chủ động quản lý
              quyền truy cập sau khi đăng nhập.
            </Notice>
          )}
          <Badge color="blue">Chưa có thanh toán trực tuyến</Badge>
        </>
      )}
    </Modal>
  );
}
