/**
 * ACE Engine Core - Error Types
 * Unified error handling for the ACE engine
 */

export class AceError extends Error {
    public readonly code: string;
    public readonly statusCode: number;

    constructor(message: string, code: string, statusCode: number = 500) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        
        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export class SecurityError extends AceError {
    constructor(message: string) {
        super(message, 'SECURITY_ERROR', 403);
    }
}

export class CapabilityError extends AceError {
    constructor(message: string, public missingCapabilities?: string[]) {
        super(message, 'CAPABILITY_ERROR', 400);
    }
}

export class ValidationError extends AceError {
    constructor(message: string, public details?: any) {
        super(message, 'VALIDATION_ERROR', 400);
    }
}

export class StorageError extends AceError {
    constructor(message: string, public operation?: string) {
        super(message, 'STORAGE_ERROR', 500);
    }
}

export class ConfigurationError extends AceError {
    constructor(message: string, public field?: string) {
        super(message, 'CONFIGURATION_ERROR', 400);
    }
}

