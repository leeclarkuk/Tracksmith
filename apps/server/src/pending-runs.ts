type PendingKind = 'chat' | 'task_runner';

export class PendingRunRegistry {
  private byCard = new Map<string, PendingKind>();
  private slotToCard = new Map<string, string>();
  private taskToCard = new Map<string, string>();

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
