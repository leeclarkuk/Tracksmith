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

  it('passes multi-token negated criteria on successful task output', () => {
    const corpus =
      'Step 1 PASSED unit tests / Step 2 PASSED integration tests / Task completed: 2/2 steps passed';
    expect(evaluateAcceptanceCriteria(['No regressions in existing tests'], corpus)[0]?.passed).toBe(true);
    expect(evaluateAcceptanceCriteria(['no data loss during migration'], 'Step 1 PASSED migration ran, 0 rows lost')[0]?.passed).toBe(true);
    expect(evaluateAcceptanceCriteria(['no breaking changes to the public API'], 'Step 1 PASSED updated public API docs; changes are additive')[0]?.passed).toBe(true);
  });

  it('fails multi-token negated criteria when violations are present', () => {
    const checks = evaluateAcceptanceCriteria(
      ['No regressions in existing tests'],
      'Step 1 FAILED regression detected in checkout flow',
    );
    expect(checks[0]?.passed).toBe(false);
  });

  it('fails no test failures criterion when steps failed', () => {
    const checks = evaluateAcceptanceCriteria(
      ['no test failures'],
      'Run unit tests FAILED 3 assertions failed in checkout',
    );
    expect(checks[0]?.passed).toBe(false);
  });

  it('passes all tests pass with zero failures on clean output', () => {
    const corpus =
      'Step 1 PASSED unit tests / Step 2 PASSED integration tests / Task completed: 2/2 steps passed';
    expect(evaluateAcceptanceCriteria(['all tests pass with zero failures'], corpus)[0]?.passed).toBe(true);
  });

  it('passes no errors when output reports zero errors', () => {
    expect(
      evaluateAcceptanceCriteria(['no errors'], 'Step 1 PASSED build completed with 0 errors')[0]?.passed,
    ).toBe(true);
  });

  it('fails all tests pass when failures remain in output', () => {
    expect(
      evaluateAcceptanceCriteria(['all tests pass'], 'Suite finished: tests passed, 2 failures remain')[0]?.passed,
    ).toBe(false);
    expect(
      evaluateAcceptanceCriteria(['all tests pass'], 'Suite finished: tests passed, 1 failing spec')[0]?.passed,
    ).toBe(false);
  });

  it('fails no errors when errors appear in output', () => {
    expect(evaluateAcceptanceCriteria(['no errors'], '3 errors found in the console output')[0]?.passed).toBe(false);
  });

  it('does not pass pass-style criteria without subject evidence', () => {
    const corpus = 'Step 1 PASSED Update README / wrote docs / Task completed: 1/1 steps passed';
    expect(evaluateAcceptanceCriteria(['unit tests pass'], corpus)[0]?.passed).toBe(false);
    expect(evaluateAcceptanceCriteria(['integration tests pass'], corpus)[0]?.passed).toBe(false);
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
