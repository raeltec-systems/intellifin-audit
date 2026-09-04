import { describe, expect, it } from 'vitest';
import { createRetryAcknowledgement } from './RetryPlanDerivation';

describe('retry acknowledgement generation', () => {
  it('blocks duplicate requests until the server moves, then permits retry after another failure', () => {
    const gate = createRetryAcknowledgement('failed:digest:attempt1');
    gate.acknowledge(gate.generation);
    gate.observe('failed:digest:attempt1');
    expect(gate.blocked).toBe(true);
    gate.observe('pending:digest:attempt1');
    gate.observe('failed:digest:attempt1');
    expect(gate.blocked).toBe(false);
    gate.acknowledge(gate.generation);
    expect(gate.blocked).toBe(true);
  });
  it('does not let a late queued response block an already observed new failure', () => {
    const gate = createRetryAcknowledgement('failed:digest:attempt1');
    const requestGeneration = gate.generation;
    gate.observe('pending:digest:attempt1');
    gate.observe('failed:digest:attempt2');
    gate.acknowledge(requestGeneration);
    expect(gate.blocked).toBe(false);
  });
  it('detects a new attempt even if polling did not observe the pending interval', () => {
    const gate = createRetryAcknowledgement('failed:digest:attempt1');
    gate.acknowledge(gate.generation);
    gate.observe('failed:digest:attempt2');
    expect(gate.blocked).toBe(false);
  });
});
