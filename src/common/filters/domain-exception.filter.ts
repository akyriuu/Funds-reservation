import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { DomainError } from '../errors/domain.error';

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter { 
    catch(error: DomainError, host: ArgumentsHost): void { 
        const response = host.switchToHttp().getResponse<Response>();

        response.status(error.status).json({
            error: error.code,
            message: error.message,
            ...(error.details && { details: error.details }),
        });
    }
}