import { z } from 'zod';
import type { LlmFunctionDefinition, LlmToolCall } from '../llm/types.js';
import { CartCalculatorSkill, cartCalculatorRequestSchema } from './skills/cartCalculator.js';
import {
  HardwareCompatibilitySkill,
  hardwareCompatibilityRequestSchema,
} from './skills/hardwareCompatibilityCheck.js';
import { identifyIntentRequestSchema } from './skills/identifyIntent.js';

// Registro central das tools: definicoes (para o LLM) e execucao (skills).

export interface AgentToolExecutor {
  definitions: LlmFunctionDefinition[];
  execute(call: LlmToolCall): Promise<string>;
}

export interface OrderStatusInfo {
  orderId: string;
  status: string;
  totalCents?: number;
  paymentMethod?: string;
  createdAt?: string;
}

export type { IntentReport } from './skills/identifyIntent.js';
export { classifyIntent } from './skills/identifyIntent.js';
export { CartCalculatorSkill, defaultFreightCalculator } from './skills/cartCalculator.js';
export type { CartResult } from './skills/cartCalculator.js';
export { HardwareCompatibilitySkill } from './skills/hardwareCompatibilityCheck.js';
export type { CompatibilityReport } from './types.js';
export { ProductSpecResolver } from './skills/resolveProductSpecs.js';

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, raw: Record<string, unknown>): z.output<T> {
  return schema.parse(raw);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

export interface ToolRegistryOptions {
  hardwareCompatibility: HardwareCompatibilitySkill;
  cartCalculator: CartCalculatorSkill;
  getOrderStatus?: (orderId: string) => Promise<OrderStatusInfo | null>;
}

export class ToolRegistry implements AgentToolExecutor {
  readonly definitions: LlmFunctionDefinition[];
  private readonly hardware: HardwareCompatibilitySkill;
  private readonly cart: CartCalculatorSkill;
  private readonly getOrderStatus?: ToolRegistryOptions['getOrderStatus'];

  constructor(options: ToolRegistryOptions) {
    this.hardware = options.hardwareCompatibility;
    this.cart = options.cartCalculator;
    this.getOrderStatus = options.getOrderStatus;
    this.definitions = [
      {
        name: 'identify_intent',
        description:
          'Classifica a intencao do cliente e extrai a wishlist. Use na primeira mensagem de um novo assunto.',
        parameters: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              enum: ['purchase', 'hardware_check', 'cart_quote', 'payment_status', 'track_order', 'greeting', 'handoff'],
            },
            wishlist: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sku: { type: 'string' },
                  description: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1, default: 1 },
                },
              },
            },
          },
          required: ['intent'],
        },
      },
      {
        name: 'check_hardware_compatibility',
        description:
          'Valida compatibilidade entre os componentes (soquete, memoria, TDP x fonte, gabinete x GPU).',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: {
                    type: 'string',
                    enum: ['cpu', 'motherboard', 'gpu', 'psu', 'memory', 'case'],
                  },
                  description: { type: 'string' },
                  sku: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1, default: 1 },
                },
                required: ['kind', 'description'],
              },
            },
          },
          required: ['items'],
        },
      },
      {
        name: 'calculate_cart',
        description:
          'Consulta estoque no ERP, calcula frete, trava itens por 15 min e monta o valor final.',
        parameters: {
          type: 'object',
          properties: {
            skus: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sku: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1, default: 1 },
                },
                required: ['sku'],
              },
            },
            zipCode: { type: 'string', description: 'CEP de 8 digitos' },
            lockItems: { type: 'boolean', default: true },
          },
          required: ['skus'],
        },
      },
      {
        name: 'check_order_status',
        description:
          'Consulta o status de um pedido existente pelo ID (ex.: ORDER-7001). Use quando o cliente quiser rastrear um pedido.',
        parameters: {
          type: 'object',
          properties: {
            orderId: { type: 'string', description: 'ID do pedido, ex.: ORDER-7001' },
          },
          required: ['orderId'],
        },
      },
    ];
  }

  async execute(call: LlmToolCall): Promise<string> {
    switch (call.name) {
      case 'identify_intent': {
        const req = parseOrThrow(identifyIntentRequestSchema, call.arguments);
        return json({ ok: true, intent: req.intent, wishlist: req.wishlist ?? [] });
      }
      case 'check_hardware_compatibility': {
        const req = parseOrThrow(hardwareCompatibilityRequestSchema, call.arguments);
        const report = await this.hardware.run(req);
        return json(report);
      }
      case 'calculate_cart': {
        const req = parseOrThrow(cartCalculatorRequestSchema, call.arguments);
        const cart = await this.cart.run(req);
        return json(cart);
      }
      case 'check_order_status': {
        if (!this.getOrderStatus) {
          return json({ ok: false, message: 'rastreamento indisponivel no momento' });
        }
        const req = parseOrThrow(
          z.object({ orderId: z.string().min(1) }),
          call.arguments,
        );
        const order = await this.getOrderStatus(req.orderId);
        return json(
          order
            ? { ok: true, order }
            : { ok: false, orderId: req.orderId, message: 'Pedido nao encontrado' },
        );
      }
      default:
        throw new Error(`Tool desconhecida: ${call.name}`);
    }
  }
}
