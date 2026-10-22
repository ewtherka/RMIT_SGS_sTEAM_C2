import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

export class ApiError extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
  ) {
    super({ code, message }, status);
  }
}
export const bad = (code: string, message: string): never => {
  throw new ApiError(400, code, message);
};
export const forbidden = (): never => {
  throw new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
};
export const missing = (): never => {
  throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy dữ liệu trong phạm vi được phép.');
};
export const conflict = (code: string, message: string): never => {
  throw new ApiError(409, code, message);
};

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { requestId?: string }>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Không thể hoàn tất yêu cầu.';
    let fields: string[] | undefined;
    if (error instanceof ApiError) {
      status = error.getStatus();
      code = error.code;
      message = (error.getResponse() as { message: string }).message;
    } else if (error instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Dữ liệu đầu vào không hợp lệ.';
      fields = [...new Set(error.issues.map((i) => i.path.join('.')))];
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR';
      message = status === 404 ? 'Không tìm thấy endpoint.' : 'Yêu cầu không hợp lệ.';
    } else if (
      error &&
      typeof error === 'object' &&
      'type' in error &&
      ['entity.parse.failed', 'entity.too.large'].includes(String(error.type))
    ) {
      status = error.type === 'entity.too.large' ? 413 : 400;
      code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON';
      message = 'Dữ liệu JSON không hợp lệ hoặc quá lớn.';
    } else if (
      error instanceof Error &&
      /SLOT_CONFLICT|PATIENT_CONFLICT|TIME_OFF_CONFLICT/.test(error.message)
    ) {
      status = 409;
      code = 'SLOT_UNAVAILABLE';
      message = 'Lịch không còn khả dụng hoặc trùng một cuộc hẹn khác.';
    } else if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      status = 409;
      code = 'DUPLICATE_RESOURCE';
      message = 'Dữ liệu đã tồn tại.';
    }
    // Never log request bodies, ciphertext, tokens, contact details or raw database errors.
    if (status >= 500)
      console.error(
        JSON.stringify({
          requestId: req.requestId,
          code,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    res.status(status).json({ code, message, requestId: req.requestId, ...(fields ? { fields } : {}) });
  }
}
