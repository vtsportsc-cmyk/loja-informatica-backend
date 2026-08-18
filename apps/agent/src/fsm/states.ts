export const BotStateId = {
  GREETING: 'GREETING',
  HARDWARE_CHECK: 'HARDWARE_CHECK',
  STOCK_AND_FREIGHT: 'STOCK_AND_FREIGHT',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  TRACK_ORDER: 'TRACK_ORDER',
  HANDOFF: 'HANDOFF',
} as const;

export type BotStateId = (typeof BotStateId)[keyof typeof BotStateId];

export type BotEvent =
  | { type: 'INTENT_PURCHASE' } // cliente pediu para comprar/montar PC -> iniciar checagem
  | { type: 'SPECS_CONFIRMED' } // hardware validado (soquete/TDP/memoria/gabinete) -> estoque+frete
  | { type: 'CART_READY' } // carrinho fechado, frete calculado -> cobranca
  | { type: 'PAYMENT_CONFIRMED'; orderId: string } // webhook de pagamento aprovado
  | { type: 'PAYMENT_EXPIRED' } // cobranca expirou -> retomar estoque/frete
  | { type: 'PAYMENT_CANCELLED' } // cliente desistiu no checkout
  | { type: 'TRACK_ORDER' } // cliente quer saber o status de um pedido
  | { type: 'RESTART' } // nova conversa / novo pedido
  | { type: 'HANDOFF'; reason: string }; // transferir para vendedor humano

export interface Transition {
  from: BotStateId;
  on: BotEvent['type'];
  to: BotStateId;
}

export const TRANSITIONS: readonly Transition[] = [
  { from: BotStateId.GREETING, on: 'INTENT_PURCHASE', to: BotStateId.HARDWARE_CHECK },
  { from: BotStateId.GREETING, on: 'RESTART', to: BotStateId.GREETING },
  { from: BotStateId.GREETING, on: 'HANDOFF', to: BotStateId.HANDOFF },

  { from: BotStateId.HARDWARE_CHECK, on: 'INTENT_PURCHASE', to: BotStateId.HARDWARE_CHECK },
  { from: BotStateId.HARDWARE_CHECK, on: 'SPECS_CONFIRMED', to: BotStateId.STOCK_AND_FREIGHT },
  { from: BotStateId.HARDWARE_CHECK, on: 'RESTART', to: BotStateId.GREETING },
  { from: BotStateId.HARDWARE_CHECK, on: 'HANDOFF', to: BotStateId.HANDOFF },

  { from: BotStateId.STOCK_AND_FREIGHT, on: 'CART_READY', to: BotStateId.PAYMENT_PENDING },
  { from: BotStateId.STOCK_AND_FREIGHT, on: 'RESTART', to: BotStateId.GREETING },
  { from: BotStateId.STOCK_AND_FREIGHT, on: 'HANDOFF', to: BotStateId.HANDOFF },

  { from: BotStateId.PAYMENT_PENDING, on: 'PAYMENT_CONFIRMED', to: BotStateId.PAYMENT_CONFIRMED },
  { from: BotStateId.PAYMENT_PENDING, on: 'PAYMENT_EXPIRED', to: BotStateId.STOCK_AND_FREIGHT },
  { from: BotStateId.PAYMENT_PENDING, on: 'PAYMENT_CANCELLED', to: BotStateId.STOCK_AND_FREIGHT },
  { from: BotStateId.PAYMENT_PENDING, on: 'HANDOFF', to: BotStateId.HANDOFF },

  { from: BotStateId.PAYMENT_CONFIRMED, on: 'RESTART', to: BotStateId.GREETING },
  { from: BotStateId.PAYMENT_CONFIRMED, on: 'HANDOFF', to: BotStateId.HANDOFF },

  { from: BotStateId.GREETING, on: 'TRACK_ORDER', to: BotStateId.TRACK_ORDER },
  { from: BotStateId.HARDWARE_CHECK, on: 'TRACK_ORDER', to: BotStateId.TRACK_ORDER },
  { from: BotStateId.STOCK_AND_FREIGHT, on: 'TRACK_ORDER', to: BotStateId.TRACK_ORDER },
  { from: BotStateId.PAYMENT_PENDING, on: 'TRACK_ORDER', to: BotStateId.TRACK_ORDER },
  { from: BotStateId.PAYMENT_CONFIRMED, on: 'TRACK_ORDER', to: BotStateId.TRACK_ORDER },
  { from: BotStateId.TRACK_ORDER, on: 'INTENT_PURCHASE', to: BotStateId.HARDWARE_CHECK },
  { from: BotStateId.TRACK_ORDER, on: 'RESTART', to: BotStateId.GREETING },
  { from: BotStateId.TRACK_ORDER, on: 'HANDOFF', to: BotStateId.HANDOFF },

  { from: BotStateId.HANDOFF, on: 'RESTART', to: BotStateId.GREETING },
];

export const TERMINAL_STATES: readonly BotStateId[] = [BotStateId.PAYMENT_CONFIRMED, BotStateId.HANDOFF];
