import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Param,
  Req,
  Headers,
  Inject,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation, ApiHeader, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { Public, type AuthRequest } from './auth/auth.js';
import { Identity, Access } from './identity.js';
import { Scheduling } from './scheduling.js';
import { Bookings } from './bookings.js';
import { Medical } from './medical.js';
import { Database } from './database.js';
import { missing, bad } from './errors.js';
import * as S from './schemas.js';

const Id = () => Param('id', new ParseUUIDPipe({ version: '4' }));
const page = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
const clinicQuery = z.object({ clinicId: S.uuid }).strict();
const KeyHeader = () =>
  ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique per user and operation; 8–128 characters. Reuse only for an identical retry.',
  });

@ApiTags('Identity')
@ApiSecurity('DPoP')
@Controller('v1')
export class IdentityController {
  constructor(@Inject(Identity) private readonly identity: Identity) {}
  @Get('me') me(@Req() r: AuthRequest) {
    return this.identity.me(r.principal);
  }
  @Post('me/onboarding')
  @S.DocumentBody(S.onboardingInput)
  onboard(@Req() r: AuthRequest, @S.BodySchema(S.onboardingInput) b: any) {
    return this.identity.onboard(r.principal, b);
  }
  @Patch('me')
  @S.DocumentBody(S.profilePatchInput)
  patch(@Req() r: AuthRequest, @S.BodySchema(S.profilePatchInput) b: any) {
    return this.identity.patch(r.principal, b);
  }
  @Get('patients')
  @S.DocumentQuery(S.patientQuery)
  patients(@Req() r: AuthRequest, @S.QuerySchema(S.patientQuery) q: any) {
    return this.identity.patients(r.principal, q);
  }
  @Post('patients')
  @S.DocumentBody(S.patientInput)
  patient(@Req() r: AuthRequest, @S.BodySchema(S.patientInput) b: any) {
    return this.identity.createPatient(r.principal, b);
  }
  @Get('me/dependents') dependents(@Req() r: AuthRequest) {
    return this.identity.dependents(r.principal);
  }
  @Post('me/dependents')
  @S.DocumentBody(S.delegationInput)
  delegate(@Req() r: AuthRequest, @S.BodySchema(S.delegationInput) b: any) {
    return this.identity.requestDelegation(r.principal, b);
  }
  @Post('delegations/:id/verify')
  @HttpCode(200)
  verify(@Req() r: AuthRequest, @Id() id: string) {
    return this.identity.verifyDelegation(r.principal, id);
  }
}

@ApiTags('Catalog & schedules')
@Controller('v1')
export class ScheduleController {
  constructor(
    @Inject(Scheduling) private readonly schedules: Scheduling,
    @Inject(Bookings) private readonly bookings: Bookings,
  ) {}
  @Public() @Get('clinics') clinics() {
    return this.schedules.clinics();
  }
  @Public()
  @Get('services')
  @S.DocumentQuery(S.catalogQuery)
  services(@S.QuerySchema(S.catalogQuery) q: any) {
    return this.schedules.services(q);
  }
  @Public()
  @Get('doctors')
  @S.DocumentQuery(S.catalogQuery)
  doctors(@S.QuerySchema(S.catalogQuery) q: any) {
    return this.schedules.doctors(q);
  }
  @Public()
  @Get('availability')
  @S.DocumentQuery(S.availabilityQuery)
  availability(@S.QuerySchema(S.availabilityQuery) q: any) {
    return this.schedules.availability(q);
  }
  @Public()
  @Get('doctors/:id/availability')
  @S.DocumentQuery(S.availabilityQuery.omit({ doctorId: true }))
  doctorAvailability(@Id() id: string, @S.QuerySchema(S.availabilityQuery.omit({ doctorId: true })) q: any) {
    return this.schedules.availability({ ...q, doctorId: id });
  }
  @ApiSecurity('DPoP')
  @Put('doctors/:id/schedule')
  @S.DocumentBody(S.scheduleInput)
  schedule(@Req() r: AuthRequest, @Id() id: string, @S.BodySchema(S.scheduleInput) b: any) {
    return this.schedules.replaceSchedule(r.principal, id, b);
  }
  @ApiSecurity('DPoP')
  @Post('doctors/:id/time-off')
  @KeyHeader()
  @S.DocumentBody(S.timeOffInput)
  leave(
    @Req() r: AuthRequest,
    @Id() id: string,
    @S.BodySchema(S.timeOffInput) b: any,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.timeOff(r.principal, id, b, key);
  }
  @ApiSecurity('DPoP')
  @Get('time-off/:id/affected-appointments')
  affected(@Req() r: AuthRequest, @Id() id: string) {
    return this.bookings.affected(r.principal, id);
  }
}

@ApiTags('Appointments')
@ApiSecurity('DPoP')
@Controller('v1/appointments')
export class AppointmentController {
  constructor(@Inject(Bookings) private readonly bookings: Bookings) {}
  @Get()
  @S.DocumentQuery(S.appointmentQuery)
  list(@Req() r: AuthRequest, @S.QuerySchema(S.appointmentQuery) q: any) {
    return this.bookings.list(r.principal, q);
  }
  @Post()
  @KeyHeader()
  @S.DocumentBody(S.appointmentInput)
  @ApiResponse({ status: 409, description: 'Slot unavailable or idempotency key mismatch' })
  create(
    @Req() r: AuthRequest,
    @S.BodySchema(S.appointmentInput) b: any,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.create(r.principal, b, key);
  }
  @Get(':id') get(@Req() r: AuthRequest, @Id() id: string) {
    return this.bookings.get(r.principal, id);
  }
  @Get(':id/timeline') timeline(@Req() r: AuthRequest, @Id() id: string) {
    return this.bookings.timeline(r.principal, id);
  }
  @Get(':id/alternatives')
  @S.DocumentQuery(S.availabilityQuery.omit({ serviceId: true }))
  alternatives(
    @Req() r: AuthRequest,
    @Id() id: string,
    @S.QuerySchema(S.availabilityQuery.omit({ serviceId: true })) q: any,
  ) {
    return this.bookings.alternatives(r.principal, id, q);
  }
  @Post(':id/reschedule')
  @HttpCode(200)
  @KeyHeader()
  @S.DocumentBody(S.rescheduleInput)
  reschedule(
    @Req() r: AuthRequest,
    @Id() id: string,
    @S.BodySchema(S.rescheduleInput) b: any,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.reschedule(r.principal, id, b, key);
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @KeyHeader()
  @S.DocumentBody(S.versionInput)
  cancel(
    @Req() r: AuthRequest,
    @Id() id: string,
    @S.BodySchema(S.versionInput) b: any,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.cancel(r.principal, id, b, key);
  }
  @Post(':id/attendance-confirmation')
  @HttpCode(200)
  @KeyHeader()
  @S.DocumentBody(S.versionInput)
  attend(
    @Req() r: AuthRequest,
    @Id() id: string,
    @S.BodySchema(S.versionInput) b: any,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.attendance(r.principal, id, b, key);
  }
  @Post(':id/check-in')
  @HttpCode(200)
  @KeyHeader()
  @S.DocumentBody(S.versionInput)
  checkIn(
    @Req() r: AuthRequest,
    @Id() id: string,
    @S.BodySchema(S.versionInput) b: any,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.transition(r.principal, id, 'CHECKED_IN', b, key);
  }
  @Post(':id/start')
  @HttpCode(200)
  @KeyHeader()
  @S.DocumentBody(S.versionInput)
  start(
    @Req() r: AuthRequest,
    @Id() id: string,
    @S.BodySchema(S.versionInput) b: any,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.transition(r.principal, id, 'IN_PROGRESS', b, key);
  }
  @Post(':id/complete')
  @HttpCode(200)
  @KeyHeader()
  @S.DocumentBody(S.versionInput)
  complete(
    @Req() r: AuthRequest,
    @Id() id: string,
    @S.BodySchema(S.versionInput) b: any,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.transition(r.principal, id, 'COMPLETED', b, key);
  }
  @Post(':id/no-show')
  @HttpCode(200)
  @KeyHeader()
  @S.DocumentBody(S.versionInput)
  noShow(
    @Req() r: AuthRequest,
    @Id() id: string,
    @S.BodySchema(S.versionInput) b: any,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.transition(r.principal, id, 'NO_SHOW', b, key);
  }
  @Post(':id/check-in-code')
  @ApiOperation({ summary: 'Issue a short-lived signed code; frontend renders the QR' })
  code(@Req() r: AuthRequest, @Id() id: string) {
    return this.bookings.checkInCode(r.principal, id);
  }
}

@ApiTags('Medical records')
@ApiSecurity('DPoP')
@Controller('v1')
export class MedicalController {
  constructor(@Inject(Medical) private readonly medical: Medical) {}
  @Get('records')
  @S.DocumentQuery(S.recordQuery)
  records(@Req() r: AuthRequest, @S.QuerySchema(S.recordQuery) q: any) {
    return this.medical.list(r.principal, q);
  }
  @Post('records')
  @S.DocumentBody(S.recordInput)
  create(@Req() r: AuthRequest, @S.BodySchema(S.recordInput) b: any) {
    return this.medical.create(r.principal, b);
  }
  @Post('records/drafts')
  @S.DocumentBody(S.recordDraftInput)
  draft(@Req() r: AuthRequest, @S.BodySchema(S.recordDraftInput) b: any) {
    return this.medical.create(r.principal, b, true);
  }
  @Put('records/:id/content')
  @S.DocumentBody(S.recordContentInput)
  content(@Req() r: AuthRequest, @Id() id: string, @S.BodySchema(S.recordContentInput) b: any) {
    return this.medical.content(r.principal, id, b);
  }
  @Post('records/:id/release')
  @HttpCode(200)
  @S.DocumentBody(S.versionInput)
  release(@Req() r: AuthRequest, @Id() id: string, @S.BodySchema(S.versionInput) b: any) {
    return this.medical.release(r.principal, id, b);
  }
  @Get('records/:id/policy') policy(@Req() r: AuthRequest, @Id() id: string) {
    return this.medical.policies(r.principal, id);
  }
  @Get('records/:id/policy-context') policyContext(@Req() r: AuthRequest, @Id() id: string) {
    return this.medical.policyContext(r.principal, id);
  }
  @Put('records/:id/policy')
  @S.DocumentBody(S.policyInput)
  @ApiOperation({ summary: 'Import externally signed bytes; does not grant or approve access' })
  importPolicy(@Req() r: AuthRequest, @Id() id: string, @S.BodySchema(S.policyInput) b: any) {
    return this.medical.importPolicy(r.principal, id, b);
  }
  @Post('records/:id/access-requests')
  @S.DocumentBody(S.accessInput)
  requestAccess(@Req() r: AuthRequest, @Id() id: string, @S.BodySchema(S.accessInput) b: any) {
    return this.medical.requestAccess(r.principal, id, b);
  }
  @Get('me/sharing') sharing(@Req() r: AuthRequest) {
    return this.medical.sharing(r.principal);
  }
  @Get('me/visits')
  @S.DocumentQuery(page)
  visits(@Req() r: AuthRequest, @S.QuerySchema(page) q: any) {
    return this.medical.visits(r.principal, q);
  }
  @Get('me/visits/:id') visit(@Req() r: AuthRequest, @Id() id: string) {
    return this.medical.visit(r.principal, id);
  }
  @Get('me/follow-ups') follows(@Req() r: AuthRequest) {
    return this.medical.followUps(r.principal);
  }
  @Put('appointments/:id/follow-up')
  @S.DocumentBody(S.followUpInput)
  follow(@Req() r: AuthRequest, @Id() id: string, @S.BodySchema(S.followUpInput) b: any) {
    return this.medical.setFollowUp(r.principal, id, b);
  }
}

@ApiTags('Notifications & reception')
@ApiSecurity('DPoP')
@Controller('v1')
export class OperationsController {
  constructor(
    @Inject(Bookings) private readonly bookings: Bookings,
    @Inject(Database) private readonly db: Database,
    @Inject(Access) private readonly access: Access,
  ) {}
  @Get('me/notifications')
  @S.DocumentQuery(page)
  notifications(@Req() r: AuthRequest, @S.QuerySchema(page) q: any) {
    const u = this.access.user(r.principal);
    return {
      items: this.db.all(
        'SELECT id,appointment_id AS appointmentId,kind,delivery_status AS deliveryStatus,created_at AS createdAt,read_at AS readAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        u.id,
        q.limit,
        q.offset,
      ),
      ...q,
    };
  }
  @Patch('me/notifications/:id/read')
  read(@Req() r: AuthRequest, @Id() id: string) {
    const u = this.access.user(r.principal);
    if (
      !this.db.run(
        'UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?',
        Date.now(),
        id,
        u.id,
      ).changes
    )
      missing();
    return { id, read: true };
  }
  @Get('contact-tasks')
  @S.DocumentQuery(clinicQuery)
  contacts(@Req() r: AuthRequest, @S.QuerySchema(clinicQuery) q: any) {
    return this.bookings.contacts(r.principal, q.clinicId);
  }
  @Patch('contact-tasks/:id')
  @S.DocumentBody(S.contactInput)
  contact(@Req() r: AuthRequest, @Id() id: string, @S.BodySchema(S.contactInput) b: any) {
    return this.bookings.updateContact(r.principal, id, b);
  }
  @Post('check-ins/scan')
  @HttpCode(200)
  @KeyHeader()
  @S.DocumentBody(S.checkInCodeInput)
  scan(
    @Req() r: AuthRequest,
    @S.BodySchema(S.checkInCodeInput) b: any,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookings.consumeCode(r.principal, b.code, key);
  }
}

@ApiTags('Free booking assistant')
@ApiSecurity('DPoP')
@Controller('v1/assistant')
export class AssistantController {
  constructor(
    @Inject(Bookings) private readonly bookings: Bookings,
    @Inject(Scheduling) private readonly schedules: Scheduling,
  ) {}
  @Post('messages')
  @HttpCode(200)
  @S.DocumentBody(S.assistantInput)
  respond(@Req() r: AuthRequest, @S.BodySchema(S.assistantInput) b: any) {
    if (b.intent === 'availability') {
      if (!b.availability) bad('MISSING_FILTER', 'Cần bộ lọc ngày và dịch vụ.');
      return {
        type: 'SLOTS',
        items: this.schedules.availability(b.availability),
        requiresExplicitBooking: true,
      };
    }
    if (b.intent === 'appointments')
      return { type: 'APPOINTMENTS', ...this.bookings.list(r.principal, { limit: 10, offset: 0 }) };
    const answers: Record<string, string> = {
      address: 'Xem địa điểm tại chi tiết phòng khám. Đây là cơ sở giả dùng cho demo.',
      hours: 'Lọc giờ trống theo bác sĩ và ngày tại mục Đặt lịch.',
      booking: 'Chọn dịch vụ, giờ còn trống rồi xác nhận. Trợ lý không tự đặt hoặc đổi lịch.',
      privacy: 'Bệnh án được mã hóa tại trình duyệt; quyền giải mã do Tide quyết định.',
    };
    return { type: 'FAQ', message: answers[b.topic ?? 'booking'], engine: 'RULE_BASED', externalApiCalls: 0 };
  }
}
