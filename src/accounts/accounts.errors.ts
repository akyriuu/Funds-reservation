import { DomainError } from '../common/errors/domain.error';

export class AccountNotFoundError extends DomainError { 
    readonly code = 'account_not_found';
    readonly status = 404;

    constructor(accountId: string) { 
        super(`Account ${accountId} was not found`, { accountId});
    }
}