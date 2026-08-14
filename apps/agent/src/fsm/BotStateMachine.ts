import { TRANSITIONS, TERMINAL_STATES } from './states.js';
import type { BotEvent, BotStateId } from './states.js';

export interface TransitionResult {
  from: BotStateId;
  to: BotStateId;
  event: BotEvent['type'];
  /** true se o estado mudou de fato (sem self-loop). */
  changed: boolean;
  /** true se o estado de destino e terminal (pago / handoff). */
  terminal: boolean;
  /** payload do evento que acionou a transicao. */
  payload?: unknown;
}

export interface BotStateMachineOptions {
  initialState?: BotStateId;
  /** Hook executado apos cada transicao (para efeitos colaterais no mundo externo). */
  onTransition?: (result: TransitionResult) => void;
}

export class InvalidTransitionError extends Error {
  constructor(from: BotStateId, eventType: BotEvent['type']) {
    super(`Transicao invalida: ${from} --${eventType}--> ?`);
    this.name = 'InvalidTransitionError';
  }
}

// Maquina de estados do atendimento:
// GREETING -> HARDWARE_CHECK -> STOCK_AND_FREIGHT -> PAYMENT_PENDING -> PAYMENT_CONFIRMED
export class BotStateMachine {
  private state: BotStateId;
  private readonly onTransition?: BotStateMachineOptions['onTransition'];
  private history: BotStateId[] = [];

  constructor(options: BotStateMachineOptions = {}) {
    this.state = options.initialState ?? 'GREETING';
    this.onTransition = options.onTransition;
  }

  get current(): BotStateId {
    return this.state;
  }

  get isTerminal(): boolean {
    return TERMINAL_STATES.includes(this.state);
  }

  /** true se existe transicao valida a partir do estado atual para o evento. */
  canTransition(eventType: BotEvent['type']): boolean {
    return TRANSITIONS.some((t) => t.from === this.state && t.on === eventType);
  }

  get path(): readonly BotStateId[] {
    return this.history;
  }

  transition(event: BotEvent): TransitionResult {
    const transition = TRANSITIONS.find(
      (t) => t.from === this.state && t.on === event.type,
    );

    if (!transition) {
      throw new InvalidTransitionError(this.state, event.type);
    }

    const result: TransitionResult = {
      from: this.state,
      to: transition.to,
      event: event.type,
      changed: this.state !== transition.to,
      terminal: TERMINAL_STATES.includes(transition.to),
      payload: event.type === 'PAYMENT_CONFIRMED' || event.type === 'HANDOFF' ? event : undefined,
    };

    if (result.changed) {
      this.history.push(this.state);
      this.state = transition.to;
    }

    this.onTransition?.(result);
    return result;
  }

  reset(): void {
    this.state = 'GREETING';
    this.history = [];
  }
}
