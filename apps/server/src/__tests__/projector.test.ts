import { buildResultFromChatHistory, buildResultFromTaskRun } from '../gateway/projector.js';

describe('buildResultFromChatHistory', () => {
  it('builds success packet', () => {
    const packet = buildResultFromChatHistory([
      { role: 'user', content: 'fix readme' },
      { role: 'assistant', content: 'Updated README at ./README.md' },
    ]);
    expect(packet.checks[0]?.passed).toBe(true);
    expect(packet.finalSummary).toContain('Updated README');
  });

  it('builds failure packet', () => {
    const packet = buildResultFromChatHistory([], true, 'timeout');
    expect(packet.checks[0]?.passed).toBe(false);
    expect(packet.risks.length).toBeGreaterThan(0);
  });
});

describe('buildResultFromTaskRun', () => {
  it('maps completed task', () => {
    const packet = buildResultFromTaskRun({
      task_id: 'abc123',
      status: 'completed',
      steps: [{ title: 'Step 1', status: 'PASSED', result: 'ok' }],
    });
    expect(packet.checks[0]?.passed).toBe(true);
    expect(packet.artifacts.some((a) => a.kind === 'branch')).toBe(true);
  });
});
