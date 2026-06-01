import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Response } from 'express';

/**
 * Translates TypeORM / Postgres errors into proper HTTP responses so the
 * API never leaks a raw 500 for predictable cases.
 *
 *   • `invalid input syntax for type uuid` → 404 Not Found
 *     (happens when a user navigates to /customers/AXC-00001, /recharges/RCH-…,
 *      /payroll/items/SLIP-001, etc. — TypeORM accepts the string but Postgres
 *      cannot cast it to the UUID column and throws code 22P02.)
 *   • `invalid input syntax for type numeric|integer|boolean` → 400 Bad Request
 *   • All other QueryFailedError → re-raise as 500 (visible in logs).
 *
 * NestJS' built-in HttpException is passed through untouched.
 */
@Catch(QueryFailedError, HttpException)
export class TypeOrmExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TypeOrmExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    // HttpExceptions — let Nest handle them as usual
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      return res.status(status).json(typeof payload === 'string' ? { message: payload, statusCode: status } : payload);
    }

    if (exception instanceof QueryFailedError) {
      const driverCode = (exception as any).code || (exception as any).driverError?.code;
      const msg = (exception as any).message || '';
      const drvMsg = (exception as any).driverError?.message || '';
      const combined = `${msg} ${drvMsg}`;

      // Postgres SQLSTATE 22P02 = invalid_text_representation.
      // Narrow this branch to the uuid case so numeric/integer/boolean cast
      // failures fall through to the 400 handler below.
      if (driverCode === '22P02' && /invalid input syntax for type uuid/i.test(combined)) {
        return res.status(HttpStatus.NOT_FOUND).json({
          message: 'Not found',
          statusCode: HttpStatus.NOT_FOUND,
        });
      }
      if (driverCode === '22P02') {
        // numeric / integer / boolean cast failure → bad request
        return res.status(HttpStatus.BAD_REQUEST).json({
          message: 'Invalid request value',
          statusCode: HttpStatus.BAD_REQUEST,
        });
      }
      // Unique constraint violation
      if (driverCode === '23505') {
        return res.status(HttpStatus.CONFLICT).json({
          message: 'Resource already exists',
          statusCode: HttpStatus.CONFLICT,
        });
      }
      // FK violation
      if (driverCode === '23503') {
        return res.status(HttpStatus.CONFLICT).json({
          message: 'Cannot delete — related records exist',
          statusCode: HttpStatus.CONFLICT,
        });
      }

      this.logger.error(`Unhandled QueryFailedError [${driverCode}]: ${combined}`, (exception as any).stack);
    } else {
      this.logger.error(`Unhandled exception: ${exception?.message}`, exception?.stack);
    }

    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: 'Internal server error',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    });
  }
}
