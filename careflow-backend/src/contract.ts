import type { OpenAPIObject } from '@nestjs/swagger';
const str = { type: 'string' };
const id = { type: 'string', format: 'uuid' };
const time = { type: 'string', format: 'date-time' };
const nullable = (schema: any) => ({ ...schema, nullable: true });
const object = (properties: Record<string, any>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const array = (items: any) => ({ type: 'array', items });
export function documentResponses(doc: OpenAPIObject) {
  doc.components ??= {};
  doc.components.schemas ??= {};
  Object.assign(doc.components.schemas, {
    ApiError: object(
      { code: str, message: str, requestId: { type: 'string', format: 'uuid' }, fields: array(str) },
      ['code', 'message', 'requestId'],
    ),
    Appointment: object({
      id,
      clinicId: id,
      patientProfileId: id,
      doctorId: id,
      doctorName: str,
      serviceId: id,
      serviceName: str,
      startsAt: time,
      endsAt: time,
      timezone: { type: 'string', example: 'Asia/Ho_Chi_Minh' },
      feeVnd: { type: 'integer' },
      durationMinutes: { type: 'integer' },
      status: {
        type: 'string',
        enum: ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
      },
      attendanceConfirmation: { type: 'string', enum: ['UNANSWERED', 'ATTENDING'] },
      disruptionStatus: { type: 'string', enum: ['NONE', 'ACTION_REQUIRED'] },
      bookingSource: { type: 'string', enum: ['WEB', 'PHONE', 'WALK_IN'] },
      version: { type: 'integer', minimum: 1 },
      followUpId: nullable(id),
      clinic: object({ name: str, address: str, arrivalInstructions: str }),
      createdAt: time,
      updatedAt: time,
    }),
    AppointmentPage: object({
      items: array(ref('Appointment')),
      limit: { type: 'integer' },
      offset: { type: 'integer' },
    }),
    Slot: object({
      slotId: str,
      clinicId: id,
      doctorId: id,
      doctorName: str,
      serviceId: id,
      startsAt: time,
      endsAt: time,
      durationMinutes: { type: 'integer' },
      feeVnd: { type: 'integer' },
      timezone: str,
    }),
    Service: object({
      id,
      clinicId: id,
      name: str,
      description: str,
      durationMinutes: { type: 'integer' },
      feeVnd: { type: 'integer' },
    }),
    Doctor: object({ id, clinicId: id, displayName: str, specialty: str, languages: array(str) }),
    Clinic: object({ id, name: str, timezone: str, address: str, arrivalInstructions: str }),
    MedicalRecord: object({
      id,
      appointmentId: id,
      title: {
        type: 'string',
        description: 'Use a neutral operational label; keep diagnosis and instructions inside ciphertext.',
      },
      kind: { type: 'string', enum: ['RESULT', 'INSTRUCTION', 'PATIENT_DOCUMENT'] },
      state: { type: 'string', enum: ['DRAFT', 'RELEASED'] },
      version: { type: 'integer' },
      ciphertext: nullable({ type: 'string', format: 'byte' }),
      encryptionScheme: { type: 'string', enum: ['TIDE_RELATIONSHIP_ATTESTATION_V1'] },
      tags: array(id),
      encryptionStatus: {
        type: 'string',
        enum: ['CLIENT_SUPPLIED_CIPHERTEXT', 'AWAITING_CLIENT_ENCRYPTION'],
      },
      policyVerification: { type: 'string', enum: ['TIDE_NETWORK_REQUIRED'] },
      createdAt: time,
      releasedAt: nullable(time),
    }),
    RecordPage: object({
      items: array(ref('MedicalRecord')),
      limit: { type: 'integer' },
      offset: { type: 'integer' },
    }),
    AccessIntent: object({
      id,
      recordId: id,
      doctorId: id,
      intent: { type: 'string', enum: ['GRANT', 'REVOKE'] },
      status: { type: 'string', enum: ['PENDING_TIDE'] },
      automaticallyGranted: { type: 'boolean', enum: [false] },
    }),
  });
  for (const [path, item] of Object.entries(doc.paths))
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      const op = operation as any;
      if (op.security?.length) {
        op.parameters ??= [];
        op.parameters.push({
          in: 'header',
          name: 'DPoP',
          required: true,
          description:
            'Fresh RFC 9449 dpop+jwt proof signed with the token-bound browser key. Do not reuse on retries.',
          schema: { type: 'string' },
        });
        for (const status of ['401', '403', '404', '409', '503'])
          op.responses[status] ??= {
            description: status === '503' ? 'Tide adapter not configured' : 'Request refused',
            content: { 'application/json': { schema: ref('ApiError') } },
          };
      }
      op.responses['400'] ??= {
        description: 'Invalid JSON, UUID or schema',
        content: { 'application/json': { schema: ref('ApiError') } },
      };
      let schema: any;
      if (path === '/v1/clinics') schema = array(ref('Clinic'));
      if (path === '/v1/services') schema = array(ref('Service'));
      if (path === '/v1/doctors') schema = array(ref('Doctor'));
      if (path.endsWith('/availability') || path.endsWith('/alternatives')) schema = array(ref('Slot'));
      if (path === '/v1/appointments')
        schema = method === 'get' ? ref('AppointmentPage') : ref('Appointment');
      if (
        /^\/v1\/appointments\/\{id\}(\/(reschedule|cancel|attendance-confirmation|check-in|start|complete|no-show))?$/.test(
          path,
        )
      )
        schema = ref('Appointment');
      if (path === '/v1/records') schema = method === 'get' ? ref('RecordPage') : ref('MedicalRecord');
      if (path === '/v1/records/drafts' || /\/records\/\{id\}\/(content|release)$/.test(path))
        schema = ref('MedicalRecord');
      if (path.endsWith('/access-requests')) schema = ref('AccessIntent');
      for (const [status, response] of Object.entries(op.responses))
        if (/^2/.test(status)) {
          (response as any).headers = {
            'X-Request-Id': { description: 'Correlation ID; no PHI in logs', schema: str },
          };
          if (schema) (response as any).content = { 'application/json': { schema } };
        }
    }
}
