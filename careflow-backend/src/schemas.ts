import { Body, Query, Injectable, type PipeTransform, applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';

export const uuid = z.uuid();
export const iso = z.iso.datetime({ offset: true });
export const base64 = z
  .string()
  .min(24)
  .max(1_400_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const name = z.string().trim().min(1).max(120);
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,25}$/);
export const profileInput = z
  .object({ displayName: name, phone: phone.optional(), email: z.email().max(254).optional() })
  .strict();
export const profilePatchInput = profileInput
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one profile field is required' });
export const onboardingInput = profileInput.extend({ clinicId: uuid, dateOfBirth: z.iso.date().optional() });
export const patientInput = z
  .object({
    clinicId: uuid,
    displayName: name,
    phone: phone.optional(),
    dateOfBirth: z.iso.date().optional(),
  })
  .strict();
export const patientQuery = z
  .object({
    clinicId: uuid,
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const catalogQuery = z
  .object({
    clinicId: uuid.optional(),
    serviceId: uuid.optional(),
    doctorId: uuid.optional(),
    q: z.string().max(100).optional(),
  })
  .strict();
export const availabilityQuery = z
  .object({
    serviceId: uuid,
    doctorId: uuid.optional(),
    from: z.iso.date(),
    to: z.iso.date(),
    after: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    before: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .strict();
export const appointmentInput = z
  .object({
    serviceId: uuid,
    doctorId: uuid,
    startsAt: iso,
    patientProfileId: uuid.optional(),
    followUpId: uuid.optional(),
    bookingSource: z.enum(['WEB', 'PHONE', 'WALK_IN']).optional(),
  })
  .strict();
export const rescheduleInput = z
  .object({ doctorId: uuid, startsAt: iso, expectedVersion: z.number().int().min(1) })
  .strict();
export const versionInput = z.object({ expectedVersion: z.number().int().min(1) }).strict();
export const appointmentQuery = z
  .object({
    date: z.iso.date().optional(),
    doctorId: uuid.optional(),
    status: z
      .enum(['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
      .optional(),
    clinicId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const timeOffInput = z
  .object({
    startsAt: iso,
    endsAt: iso,
    reason: z.enum(['UNAVAILABLE', 'LEAVE', 'SCHEDULE_CHANGE']).default('UNAVAILABLE'),
  })
  .strict();
export const scheduleInput = z
  .object({
    rules: z
      .array(
        z
          .object({
            weekday: z.number().int().min(1).max(7),
            startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
            endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          })
          .strict(),
      )
      .min(1)
      .max(28),
  })
  .strict();
export const recordInput = z
  .object({
    recordId: uuid,
    appointmentId: uuid,
    title: name,
    kind: z.enum(['RESULT', 'INSTRUCTION', 'PATIENT_DOCUMENT']),
    ciphertext: base64,
    encryptionScheme: z.literal('TIDE_RELATIONSHIP_ATTESTATION_V1'),
    tags: z.array(uuid).length(1),
  })
  .strict();
export const recordDraftInput = z
  .object({ appointmentId: uuid, title: name, kind: z.enum(['RESULT', 'INSTRUCTION', 'PATIENT_DOCUMENT']) })
  .strict();
export const recordContentInput = z
  .object({
    ciphertext: base64,
    encryptionScheme: z.literal('TIDE_RELATIONSHIP_ATTESTATION_V1'),
    tags: z.array(uuid).length(1),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export const policyInput = z
  .object({
    subjectType: z.enum(['User', 'Group']),
    subjectId: z.string().min(1).max(512),
    policyBytes: base64,
  })
  .strict();
export const recordQuery = z
  .object({
    appointmentId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const accessInput = z.object({ doctorId: uuid, intent: z.enum(['GRANT', 'REVOKE']) }).strict();
export const followUpInput = z.object({ serviceId: uuid, from: z.iso.date(), to: z.iso.date() }).strict();
export const delegationInput = z.object({ patientProfileId: uuid }).strict();
export const checkInCodeInput = z.object({ code: z.string().min(40).max(512) }).strict();
export const contactInput = z
  .object({ status: z.enum(['OPEN', 'CONTACTED', 'NEEDS_CALLBACK', 'RESOLVED']) })
  .strict();
export const assistantInput = z
  .object({
    intent: z.enum(['availability', 'appointments', 'faq']),
    availability: availabilityQuery.optional(),
    topic: z.enum(['address', 'hours', 'booking', 'privacy']).optional(),
  })
  .strict();

@Injectable()
class SchemaPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}
  transform(value: unknown) {
    return this.schema.parse(value);
  }
}
export const BodySchema = (schema: z.ZodType) => Body(new SchemaPipe(schema));
export const QuerySchema = (schema: z.ZodType) => Query(new SchemaPipe(schema));
export const DocumentBody = (schema: z.ZodType) =>
  ApiBody({ schema: z.toJSONSchema(schema, { unrepresentable: 'any' }) as any });
export const DocumentQuery = (schema: z.ZodType) => {
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' }) as any;
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([key, val]) =>
      ApiQuery({ name: key, required: json.required?.includes(key) ?? false, schema: val as any }),
    ),
  );
};
