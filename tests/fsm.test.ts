import { describe, it, expect } from 'vitest';
import { BotStateMachine } from '../src/fsm/BotStateMachine.js';
import { InvalidTransitionError } from '../src/fsm/BotStateMachine.js';
import { BotStateId } from '../src/fsm/states.js';

describe('BotStateMachine - fluxo GREETING -> ... -> PAYMENT_CONFIRMED', () => {
  it('percorre o fluxo feliz do atendimento', () => {
    const machine = new BotStateMachine();

    const r1 = machine.transition({ type: 'INTENT_PURCHASE' });
    expect(machine.current).toBe(BotStateId.HARDWARE_CHECK);
    expect(r1.changed).toBe(true);

    const r2 = machine.transition({ type: 'SPECS_CONFIRMED' });
    expect(machine.current).toBe(BotStateId.STOCK_AND_FREIGHT);

    const r3 = machine.transition({ type: 'CART_READY' });
    expect(machine.current).toBe(BotStateId.PAYMENT_PENDING);
    expect(r3.terminal).toBe(false);

    const r4 = machine.transition({ type: 'PAYMENT_CONFIRMED', orderId: 'ORDER-1' });
    expect(machine.current).toBe(BotStateId.PAYMENT_CONFIRMED);
    expect(r4.terminal).toBe(true);
    expect(r4.payload).toMatchObject({ orderId: 'ORDER-1' });
  });

  it('rejeita transicao inexistente com InvalidTransitionError', () => {
    const machine = new BotStateMachine();
    expect(() => machine.transition({ type: 'CART_READY' })).toThrow(InvalidTransitionError);
  });

  it('mantem estado em self-loop de compra dentro do HARDWARE_CHECK', () => {
    const machine = new BotStateMachine({ initialState: BotStateId.HARDWARE_CHECK });
    const r = machine.transition({ type: 'INTENT_PURCHASE' });
    expect(machine.current).toBe(BotStateId.HARDWARE_CHECK);
    expect(r.changed).toBe(false);
  });

  it('pagamento expirado retorna para STOCK_AND_FREIGHT', () => {
    const machine = new BotStateMachine({ initialState: BotStateId.PAYMENT_PENDING });
    const r = machine.transition({ type: 'PAYMENT_EXPIRED' });
    expect(machine.current).toBe(BotStateId.STOCK_AND_FREIGHT);
    expect(r.terminal).toBe(false);
  });

  it('handoff e terminal; reset volta para GREETING', () => {
    const machine = new BotStateMachine({ initialState: BotStateId.PAYMENT_PENDING });
    const r = machine.transition({ type: 'HANDOFF', reason: 'pagamento_com_erro' });
    expect(machine.current).toBe(BotStateId.HANDOFF);
    expect(r.terminal).toBe(true);

    machine.reset();
    expect(machine.current).toBe(BotStateId.GREETING);
  });

  it('dispara hook onTransition com o resultado', () => {
    const seen: string[] = [];
    const machine = new BotStateMachine({
      onTransition: (r) => seen.push(`${r.from}->${r.to}`),
    });
    machine.transition({ type: 'INTENT_PURCHASE' });
    expect(seen).toEqual(['GREETING->HARDWARE_CHECK']);
  });
});
