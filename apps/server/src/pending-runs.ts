type PendingKind = 'chat' | 'task_runner';

export class PendingRunRegistry {
  private byCard = new Map<string, PendingKind>();
  private slotToCard = new Map<string, string>();
  private taskToCard = new Map<string, string>();
  private completedTasks = new Map<string, number>();
  private static MAX_COMPLETED_TASKS = 200;

  start(cardId: string, kind: PendingKind): void {
    this.clearForCard(cardId);
    this.byCard.set(cardId, kind);
  }

  attachSlot(cardId: string, slotId: string): void {
    this.slotToCard.set(slotId, cardId);
    this.byCard.delete(cardId);
  }

  attachTask(cardId: string, taskId: string): void {
    this.taskToCard.set(taskId, cardId);
    this.byCard.delete(cardId);
  }

  noteTaskComplete(taskId: string): void {
    if (this.taskToCard.has(taskId)) return;
    this.completedTasks.set(taskId, Date.now());
    if (this.completedTasks.size > PendingRunRegistry.MAX_COMPLETED_TASKS) {
      const cutoff = Date.now() - 60 * 60 * 1000;
      for (const [id, at] of this.completedTasks.entries()) {
        if (at < cutoff) this.completedTasks.delete(id);
      }
      while (this.completedTasks.size > PendingRunRegistry.MAX_COMPLETED_TASKS) {
        const oldest = [...this.completedTasks.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
        if (!oldest) break;
        this.completedTasks.delete(oldest);
      }
    }
  }

  consumeCompletedTask(taskId: string): boolean {
    if (!this.completedTasks.has(taskId)) return false;
    this.completedTasks.delete(taskId);
    return true;
  }

  clear(cardId: string): void {
    this.clearForCard(cardId);
  }

  cardForSlot(slotId: string, expectedCardId?: string): string | undefined {
    const cardId = this.slotToCard.get(slotId);
    if (!cardId) return undefined;
    if (expectedCardId && cardId !== expectedCardId) return undefined;
    return cardId;
  }

  cardForTask(taskId: string, expectedCardId?: string): string | undefined {
    const cardId = this.taskToCard.get(taskId);
    if (!cardId) return undefined;
    if (expectedCardId && cardId !== expectedCardId) return undefined;
    return cardId;
  }

  clearForCard(cardId: string): void {
    this.byCard.delete(cardId);
    for (const [slotId, id] of this.slotToCard.entries()) {
      if (id === cardId) this.slotToCard.delete(slotId);
    }
    for (const [taskId, id] of this.taskToCard.entries()) {
      if (id === cardId) this.taskToCard.delete(taskId);
    }
  }
}
