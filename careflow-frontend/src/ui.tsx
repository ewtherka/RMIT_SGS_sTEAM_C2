import {
  useEffect,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileHeart,
  FileText,
  Heart,
  HeartPulse,
  LayoutGrid,
  Leaf,
  LockKeyhole,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { errorMessage } from "./api";
import { initials } from "./utils";
const icons: Record<string, LucideIcon> = {
  activity: Activity,
  arrow: ArrowRight,
  back: ArrowLeft,
  down: ChevronDown,
  chevron: ChevronRight,
  bell: Bell,
  calendar: CalendarDays,
  check: Check,
  help: CircleHelp,
  clock: Clock3,
  download: Download,
  file: FileText,
  heart: Heart,
  pulse: HeartPulse,
  grid: LayoutGrid,
  leaf: Leaf,
  lock: LockKeyhole,
  login: LogIn,
  logout: LogOut,
  pin: MapPin,
  menu: Menu,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  shield: ShieldCheck,
  sparkles: Sparkles,
  stethoscope: Stethoscope,
  users: Users,
  close: X,
  record: FileHeart,
  sort: ArrowDown,
};
export function Icon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  const Component = icons[name] || FileText;
  return (
    <Component
      className={`icon ${className}`}
      aria-hidden="true"
      strokeWidth={1.7}
    />
  );
}
export function Avatar({
  name,
  index = 0,
  size = "",
}: {
  name: string;
  index?: number;
  size?: string;
}) {
  return (
    <span
      className={`avatar ${["blue", "mint", "peach", "purple"][index % 4]} ${size}`}
      aria-hidden="true"
    >
      {initials(name)}
      <span className="avatar-plus">+</span>
    </span>
  );
}
export function Badge({
  children,
  color = "green",
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <span className={`badge ${color}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
export function Heading({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
export function Empty({
  icon = "file",
  title,
  text,
  children,
}: {
  icon?: string;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <Icon name="help" />
      <div>
        <strong>Chưa tải được dữ liệu</strong>
        <p>{errorMessage(error)}</p>
      </div>
      {retry && (
        <button className="button ghost small" onClick={retry}>
          <Icon name="refresh" />
          Thử lại
        </button>
      )}
    </div>
  );
}
export function Loading({ label = "Đang tải dữ liệu…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="info-strip">
      <Icon name="help" />
      <span>{children}</span>
    </div>
  );
}
export function Pager({
  offset,
  count,
  onChange,
}: {
  offset: number;
  count: number;
  onChange: (offset: number) => void;
}) {
  if (!offset && count < 30) return null;
  return (
    <div className="pager">
      <button
        className="button ghost small"
        disabled={!offset}
        onClick={() => onChange(Math.max(0, offset - 30))}
      >
        <Icon name="back" />
        Trang trước
      </button>
      <span>Trang {offset / 30 + 1}</span>
      <button
        className="button ghost small"
        disabled={count < 30}
        onClick={() => onChange(offset + 30)}
      >
        Trang sau
        <Icon name="arrow" />
      </button>
    </div>
  );
}

export function useResource<T>(
  loader: () => Promise<T>,
  dependencies: DependencyList,
) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loader()
      .then((result) => {
        if (active) setValue(result);
      })
      .catch((reason) => {
        if (active) setError(reason);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Explicit dependencies are supplied by each data-owning screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision]);
  return { value, error, loading, reload: () => setRevision((old) => old + 1) };
}

export function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    ref.current?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.isConnected && previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id="dialog-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="Đóng hộp thoại"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </dialog>,
    document.body,
  );
}
