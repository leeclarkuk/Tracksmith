import {
  canTransitionColumn,
  classifyEngine,
  deriveTitleSummary,
  resolveEngine,
} from '../types.js';

describe('canTransitionColumn', () => {
  it('allows backlog todo moves', () => {
    expect(canTransitionColumn('backlog', 'todo')).toBe(true);
    expect(canTransitionColumn('todo', 'backlog')).toBe(true);
  });

  it('blocks running as drop target', () => {
    expect(canTransitionColumn('todo', 'running')).toBe(false);
    expect(canTransitionColumn('backlog', 'running')).toBe(false);
  });

  it('blocks manual exit from running', () => {
    expect(canTransitionColumn('running', 'done')).toBe(false);
  });

  it('allows done failed correction', () => {
    expect(canTransitionColumn('done', 'failed')).toBe(true);
    expect(canTransitionColumn('failed', 'done')).toBe(true);
  });
});

describe('classifyEngine', () => {
  it('routes short prompts to chat', () => {
    expect(classifyEngine('Fix the typo in README')).toBe('chat');
  });

  it('routes structured prompts to task_runner', () => {
    expect(classifyEngine('Migrate the user service:\n1. Audit endpoints\n2. Rewrite in Go\n3. Run tests')).toBe('task_runner');
  });
});

describe('resolveEngine', () => {
  it('resolves auto via classifier', () => {
    expect(resolveEngine('auto', 'hello')).toBe('chat');
  });

  it('keeps autopilot distinct', () => {
    expect(resolveEngine('autopilot', 'build feature')).toBe('autopilot');
  });
});

describe('deriveTitleSummary', () => {
  it('truncates long first lines', () => {
    const long = 'x'.repeat(100);
    const { title } = deriveTitleSummary(long);
    expect(title.length).toBeLessThanOrEqual(80);
  });
});
