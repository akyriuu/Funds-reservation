export abstract class DomainError extends Error { 
    abstract readonly code: string;
    abstract readonly status: number;

    constructor(
        message: string,
        readonly details?: Record<string, unknown>,
    ) { 
        super(message);
        this.name = new.target.name;
    }
}