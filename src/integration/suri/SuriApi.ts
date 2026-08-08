import { suriReplySchema, suriTicketUpdateSchema } from '../../types/index.js';
import type { SuriReply, SuriTicketUpdate } from '../../types/index.js';

export interface SuriApiOptions {
  baseURL: string;
  webhookToken: string;
  fetchImpl?: typeof fetch;
}

// Cliente da plataforma SURI: envia respostas e atualiza status do ticket.
export class SuriApi {
  private readonly baseURL: string;
  private readonly webhookToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SuriApiOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, '');
    this.webhookToken = options.webhookToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendReply(reply: SuriReply): Promise<void> {
    const payload = suriReplySchema.parse(reply);
    const res = await this.request('/messages', payload);
    if (!res.ok) throw new Error(`SURI send reply HTTP ${res.status}`);
  }

  async updateTicket(update: SuriTicketUpdate): Promise<void> {
    const payload = suriTicketUpdateSchema.parse(update);
    const res = await this.request(
      `/tickets/${encodeURIComponent(update.ticketId)}/status`,
      payload,
    );
    if (!res.ok) throw new Error(`SURI update ticket HTTP ${res.status}`);
  }

  private async request(path: string, body: unknown): Promise<Response> {
    return this.fetchImpl(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.webhookToken}`,
      },
      body: JSON.stringify(body),
    });
  }
}
