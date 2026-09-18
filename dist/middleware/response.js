export const createSuccessResponse = (data, statusCode = 200, message = "Resource retrieved successfully.") => {
    return {
        success: true,
        status_code: statusCode,
        message,
        error: false,
        error_code: null,
        data,
    };
};
export const createErrorResponse = (statusCode, message, errorCode = "INTERNAL_SERVER_ERROR") => {
    return {
        success: false,
        status_code: statusCode,
        message,
        error: true,
        error_code: errorCode,
        data: null,
    };
};
export class AppError extends Error {
    statusCode;
    errorCode;
    constructor(statusCode, message, errorCode) {
        super(message);
        this.name = "AppError";
        this.statusCode = statusCode;
        this.errorCode = errorCode;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
