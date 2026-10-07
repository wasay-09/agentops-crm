/** Errors that map to an HTTP response. Messages are safe to show to API clients. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string, code = 'invalid_request') => new AppError(400, code, message);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);

export class BudgetExceededError extends AppError {
  constructor(message = 'Team budget exhausted for this month') {
    super(402, 'budget_exceeded', message);
  }
}
