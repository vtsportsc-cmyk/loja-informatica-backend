export class ErpRequestError extends Error {
  readonly action: string;
  readonly status: number;
  readonly body: string;

  constructor(action: string, status: number, body: string) {
    super(`ERP ${action} falhou com HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = 'ErpRequestError';
    this.action = action;
    this.status = status;
    this.body = body;
  }
}
