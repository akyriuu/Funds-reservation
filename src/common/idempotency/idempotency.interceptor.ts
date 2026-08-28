import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
  } from '@nestjs/common';
  import { Request, Response } from 'express';
  import { from, map, mergeMap, Observable, of, throwError } from 'rxjs';
  import { catchError } from 'rxjs/operators';
  import { MissingIdempotencyKeyError } from './idempotency.errors';
  import { IdempotencyService, IdempotentRequest } from './idempotency.service';
  
  @Injectable()
  export class IdempotencyInterceptor implements NestInterceptor {
    constructor(private readonly idempotency: IdempotencyService) {}
  
    async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      const http = context.switchToHttp();
      const key = http.getRequest<Request>().header('idempotency-key');
  
      if (!key) {
        throw new MissingIdempotencyKeyError();
      }
  
      const response = http.getResponse<Response>();
      const request: IdempotentRequest = {
        key,
        endpoint: `${context.getClass().name}.${context.getHandler().name}`,
        body: http.getRequest<Request>().body,
      };
  
      const replayed = await this.idempotency.claim(request);
  
      if (replayed) {
        response.status(replayed.status);
        return of(replayed.body);
      }
  
      return next.handle().pipe(
        mergeMap((body) =>
          from(
            this.idempotency.complete(request, {
              status: response.statusCode,
              body,
            }),
          ).pipe(map(() => body)),
        ),
        catchError((error) =>
          from(this.idempotency.discard(request)).pipe(
            mergeMap(() => throwError(() => error)),
          ),
        ),
      );
    }
  }