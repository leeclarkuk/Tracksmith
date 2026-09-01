import { evaluateAcceptanceCriteria, allChecksPassed } from '../goal-contract.js';

describe('evaluateAcceptanceCriteria', () => {
  it('passes when criterion text appears in corpus', () => {
    const checks = evaluateAcceptanceCriteria(['smoke tests pass'], 'All smoke tests pass against staging');
    expect(checks[0]?.passed).toBe(true);
  });

  it('passes negated criteria when prohibited content is absent', () => {
    const checks = evaluateAcceptanceCriteria(['no errors'], 'All smoke tests pass against staging');
    expect(checks[0]?.passed).toBe(true);
  });

  it('fails negated error criteria when errors appear later in output', () => {
    const checks = evaluateAcceptanceCriteria(
      ['no errors'],
      'No errors in step 1 but deploy failed with an error',
    );
    expect(checks[0]?.passed).toBe(false);
  });

  it('does not treat negated pass wording as success', () => {
    const checks = evaluateAcceptanceCriteria(['tests pass'], 'Tests did not pass on staging');
    expect(checks[0]?.passed).toBe(false);
  });

  it('passes without-criteria when subject absent', () => {
    const checks = evaluateAcceptanceCriteria(['without regressions'], 'Completed without regressions in staging');
    expect(checks[0]?.passed).toBe(true);
  });

  it('fails when criterion missing', () => {
    const checks = evaluateAcceptanceCriteria(['database migrated'], 'Updated README only');
    expect(checks[0]?.passed).toBe(false);
  });
});

describe('allChecksPassed', () => {
  it('requires every check to pass', () => {
    expect(allChecksPassed([{ name: 'a', passed: true, evidence: '' }])).toBe(true);
    expect(allChecksPassed([{ name: 'a', passed: true, evidence: '' }, { name: 'b', passed: false, evidence: '' }])).toBe(false);
  });
});
