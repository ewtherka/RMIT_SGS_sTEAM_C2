export interface Clinic {
  id: string;
  name: string;
  timezone: string;
  address: string;
  arrivalInstructions: string;
}
export interface Service {
  id: string;
  clinicId: string;
  name: string;
  description: string;
  durationMinutes: number;
  feeVnd: number;
}
export interface Doctor {
  id: string;
  clinicId: string;
  displayName: string;
  specialty: string;
  languages: string[];
}
export interface Slot {
  slotId: string;
  clinicId: string;
  doctorId: string;
  doctorName: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  feeVnd: number;
  timezone: string;
}
export type AppointmentStatus =
  | "CONFIRMED"
  | "CHECKED_IN"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";
export interface Appointment extends Omit<Slot, "slotId"> {
  id: string;
  patientProfileId: string;
  serviceName: string;
  status: AppointmentStatus;
  attendanceConfirmation: "UNANSWERED" | "ATTENDING";
  disruptionStatus: "NONE" | "ACTION_REQUIRED";
  bookingSource: "WEB" | "PHONE" | "WALK_IN";
  version: number;
  followUpId: string | null;
  clinic: Omit<Clinic, "id" | "timezone">;
  createdAt: string;
  updatedAt: string;
}
export interface Me {
  onboardingRequired: boolean;
  id?: string;
  displayName?: string;
  email?: string | null;
  phone?: string | null;
  roles: string[];
  patientProfileId?: string | null;
  clinicIds?: string[];
}
export interface AuthConfig {
  mode?: "SIMULATED" | "STRICT";
  configured: boolean;
  adapter: Record<string, unknown> | null;
  apiOrigin: string;
  callbackPath: string;
  dpopRequired: boolean;
}
export interface SimIdentity {
  userId: string;
  displayName: string;
  roles: string[];
}
export interface SimLogin {
  mode: "SIMULATED";
  tokenType: "Bearer";
  accessToken: string;
  expiresIn: number;
  userId: string;
  roles: string[];
}
export interface SimApproval {
  id: string;
  recordId: string;
  recordTitle: string;
  doctorId: string;
  doctorName: string;
  intent: "GRANT" | "REVOKE";
  status: "PENDING_TIDE" | "COMMITTED";
  approvals: { adminId: string; displayName: string; approvedAt: string }[];
  quorum: { threshold: number; of: number; reached: boolean };
  createdAt: string;
  enforcedBy: string;
}
export interface SimAccess {
  emergencies?: EmergencyRequest[];
  recordId: string;
  canDecrypt: boolean;
  allowedBy: string | null;
  grantedDoctorIds: string[];
  requests: SimApproval[];
  quorum: { threshold: number; of: number };
}
export interface EmergencyRequest {
  id: string;
  recordId: string;
  recordTitle: string;
  doctorId: string;
  doctorName: string;
  reason: string;
  status: "PENDING_TIDE" | "COMMITTED" | "EXPIRED" | "ENDED";
  durationMinutes: number;
  expiresAt: string | null;
  approvals: { adminId: string; displayName: string; approvedAt: string }[];
  quorum: { threshold: number; of: number; reached: boolean };
  createdAt: string;
  enforcedBy: string;
}
export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
}
export interface MedicalRecord {
  id: string;
  appointmentId: string;
  title: string;
  kind: "RESULT" | "INSTRUCTION" | "PATIENT_DOCUMENT";
  state: "DRAFT" | "RELEASED";
  version: number;
  ciphertext: string | null;
  tags: string[];
  encryptionScheme: string;
  encryptionStatus: "CLIENT_SUPPLIED_CIPHERTEXT" | "AWAITING_CLIENT_ENCRYPTION";
  policyVerification: "TIDE_NETWORK_REQUIRED";
  createdAt: string;
  releasedAt: string | null;
}
export interface Policies {
  recordId: string;
  tags: string[];
  policies: {
    id: string;
    subjectType: "User" | "Group";
    subjectId: string;
    policyBytes: string;
  }[];
  verification: string;
}
export interface AccessRequest {
  id: string;
  recordId?: string;
  doctorId: string;
  intent: "GRANT" | "REVOKE";
  status: "PENDING_TIDE";
  createdAt?: number;
  automaticallyGranted?: false;
}
export interface Sharing {
  verification: "UNVERIFIED";
  items: {
    recordId: string;
    title: string;
    effectivePermissions: "UNVERIFIED";
    policyReferences: { subjectType: string; subjectId: string }[];
    requests: AccessRequest[];
  }[];
}
export interface Visit extends Appointment {
  records: MedicalRecord[];
  followUp?: {
    id: string;
    serviceId: string;
    fromMs: number;
    toMs: number;
  } | null;
}
export interface FollowUp {
  id: string;
  previousAppointmentId: string;
  serviceId: string;
  preferredDoctorId: string;
  from: string;
  to: string;
  bookedAppointmentId: string | null;
}
export interface Notification {
  id: string;
  appointmentId: string;
  kind: string;
  deliveryStatus: "SIMULATED";
  createdAt: number;
  readAt: number | null;
}
export interface BookingInput {
  serviceId: string;
  doctorId: string;
  startsAt: string;
  followUpId?: string;
}
export interface AvailabilityQuery {
  serviceId: string;
  doctorId?: string;
  from: string;
  to: string;
  after?: string;
  before?: string;
}
