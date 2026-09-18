export interface ApiSuccessResponse<T> {
  success: true;
  status_code: number;
  message: string;
  error: false;
  error_code: null;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  status_code: number;
  message: string;
  error: true;
  error_code: string;
  data: null;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export const createSuccessResponse = <T>(
  data: T,
  statusCode = 200,
  message = "Resource retrieved successfully."
): ApiSuccessResponse<T> => {
  return {
    success: true,
    status_code: statusCode,
    message,
    error: false,
    error_code: null,
    data,
  };
};

export const createErrorResponse = (
  statusCode: number,
  message: string,
  errorCode = "INTERNAL_SERVER_ERROR"
): ApiErrorResponse => {
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
  public readonly statusCode: number;
  public readonly errorCode: string;

  constructor(statusCode: number, message: string, errorCode: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
