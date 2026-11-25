import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

/** One error envelope for the whole API: {"error":{"code","message"}} */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: any = exception.getResponse();
      if (body && typeof body === 'object' && body.error?.code) return res.status(status).json(body);
      const code = status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : status === 401 ? 'UNAUTHORIZED' : 'VALIDATION_ERROR';
      const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message ?? exception.message;
      return res.status(status).json({ error: { code, message } });
    }
    console.error(exception);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  }
}
