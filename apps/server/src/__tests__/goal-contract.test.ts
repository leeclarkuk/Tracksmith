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

  it('fails negated criteria when prohibited content is present', () => {
    const checks = evaluateAcceptanceCriteria(['no errors'], 'Build failed with error in deploy step');
    expect(checks[0]?.passed).toBe(false);
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
