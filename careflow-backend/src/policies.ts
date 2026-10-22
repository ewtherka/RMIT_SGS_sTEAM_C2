import { Policy, ApprovalType, ExecutionType } from './vendor/tide-policy.js';
import { bad, conflict } from './errors.js';
import { readAdapter, type AppConfig } from './config.js';
import type { Row } from './database.js';
export const careGroup = (clinicId: string, recordId: string) =>
  `/careflow/${clinicId}/records/${recordId}/care-team`;

export function validatePolicy(config: AppConfig, r: Row, patientKey: string | undefined, b: any) {
  const adapter = readAdapter(config.adapterPath);
  if (!adapter?.vendorId)
    return conflict('TIDE_VENDOR_NOT_CONFIGURED', 'Cần adapter có vendorId thật trước khi import policy.');
  let policy: Policy;
  try {
    policy = Policy.from(new Uint8Array(Buffer.from(b.policyBytes, 'base64')));
  } catch {
    return bad('INVALID_POLICY', 'Không đọc được định dạng policy Tide.');
  }
  const param = (name: string) => policy.params.entries.get(name);
  let roles: unknown;
  try {
    roles = JSON.parse(String(param('roles')));
  } catch {
    return bad('INVALID_POLICY', 'Policy thiếu danh sách quyền hợp lệ.');
  }
  if (
    policy.contractId !== 'RelationshipAttestation:1' ||
    policy.keyId !== adapter.vendorId ||
    policy.approvalType !== ApprovalType.IMPLICIT ||
    policy.executionType !== ExecutionType.PRIVATE ||
    policy.hasExpired() ||
    policy.signature?.length !== 64 ||
    param('assignmentId') !== r.id ||
    param('subjectType') !== b.subjectType ||
    param('subjectId') !== b.subjectId ||
    !Array.isArray(roles) ||
    !roles.length ||
    roles.some((x) => !['_tide_encryptor', '_tide_decryptor'].includes(x)) ||
    !policy.modelIds.includes('PolicyEnabledEncryption:1') ||
    !policy.modelIds.includes('PolicyEnabledDecryption:1')
  )
    return bad(
      'POLICY_SCOPE_MISMATCH',
      'Policy không khớp vendor, contract, hồ sơ, chủ thể, chữ ký hoặc phạm vi cho phép.',
    );
  if (b.subjectType === 'User' && (!patientKey || b.subjectId !== patientKey))
    return bad(
      'POLICY_SUBJECT_MISMATCH',
      'User policy phải dành cho tideuserkey đã xác minh của bệnh nhân sở hữu hồ sơ.',
    );
  if (b.subjectType === 'Group' && b.subjectId !== careGroup(r.clinic_id, r.id))
    return bad('POLICY_SUBJECT_MISMATCH', 'Group policy phải dành cho care-team của đúng hồ sơ này.');
  // Parsing and scope validation are NOT signature/quorum verification. The network must verify both.
  return { scopeValidated: true, signatureVerified: false, quorumVerified: false };
}
