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

  it('fails negated error criteria when the prohibited subject appears later', () => {
    const checks = evaluateAcceptanceCriteria(
      ['no errors'],
      'No errors in step 1 but later errors were reported',
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

  it.each([
    {
      criterion: 'no data loss during migration',
      absence: 'Step 1 PASSED unit tests / Step 2 PASSED deploy to staging',
      explicit: 'Verified no data loss during migration after cutover',
      zero: 'Migration complete with 0 data loss during migration',
      violation: 'Observed data loss during migration on table orders',
    },
    {
      criterion: 'no breaking changes to the public API',
      absence: 'Step 1 PASSED updated public API docs; changes are additive',
      explicit: 'Confirmed no breaking changes to the public API',
      zero: 'Release notes: 0 breaking changes to the public API',
      violation: 'Introduced breaking changes to the public API in /v1/users',
    },
    {
      criterion: 'no regressions in existing tests',
      absence: 'Step 1 PASSED unit tests / Step 2 PASSED integration tests',
      explicit: 'There were no regressions in existing tests',
      zero: 'Suite finished with 0 regressions in existing tests',
      violation: 'Found regressions in existing tests in checkout flow',
    },
    {
      criterion: 'no secrets committed to the repository',
      absence: 'Step 1 PASSED lint / Step 2 PASSED unit tests',
      explicit: 'Scan confirmed no secrets committed to the repository',
      zero: 'Secret scan: 0 secrets committed to the repository',
      violation: 'secrets committed to the repository in apps/server/.env',
    },
  ])('$criterion', ({ criterion, absence, explicit, zero, violation }) => {
    expect(evaluateAcceptanceCriteria([criterion], absence)[0]?.passed).toBe(true);
    expect(evaluateAcceptanceCriteria([criterion], explicit)[0]?.passed).toBe(true);
    expect(evaluateAcceptanceCriteria([criterion], zero)[0]?.passed).toBe(true);
    expect(evaluateAcceptanceCriteria([criterion], violation)[0]?.passed).toBe(false);
  });

  it('fails no test failures criterion when the prohibited subject appears', () => {
    const checks = evaluateAcceptanceCriteria(
      ['no test failures'],
      'Run unit tests FAILED with test failures in checkout',
    );
    expect(checks[0]?.passed).toBe(false);
  });

  it('passes all tests pass with zero failures on clean output', () => {
    const corpus =
      'Step 1 PASSED all tests / Step 2 PASSED integration tests / all tests passed with zero failures';
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
