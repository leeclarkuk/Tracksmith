import { catchDetached, eventLogContext } from '../gateway/listener.js';

describe('catchDetached', () => {
  it('catches a rejected event handler and does not emit unhandledRejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const originalError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    try {
      const event = { type: 'task_complete', taskId: 't-1', slotId: 's-9' };
      await catchDetached(
        Promise.reject(new Error('mutate failed')),
        'event handler failed',
        eventLogContext(event),
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
      expect(errorCalls).toEqual([
        [
          '[gateway-ws] event handler failed',
          expect.objectContaining({
            type: 'task_complete',
            taskId: 't-1',
            slotId: 's-9',
            error: 'mutate failed',
          }),
        ],
      ]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      console.error = originalError;
    }
  });
});
