export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public uncertain = false,
    public code?: string,
  ) {
    super(message);
  }
}
