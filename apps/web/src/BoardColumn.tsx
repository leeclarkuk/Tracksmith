import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { OutcomeCard } from '@tracksmith/shared';
import { SortableCard } from './SortableCard';

interface Props {
  column: { id: string; title: string; droppable: boolean };
  cards: OutcomeCard[];
  onOpen: (id: string) => void;
  onRun: (id: string) => void;
  onHost: (id: string) => void;
}

export function BoardColumn({ column, cards, onOpen, onRun, onHost }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    disabled: !column.droppable,
  });

  return (
    <div className={`column ${column.id === 'running' ? 'column-running' : ''}`}>
      <div className="column-header">
        <span>{column.title}</span>
        <span>{cards.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className="column-body"
        style={isOver && column.droppable ? { outline: '1px solid var(--accent)' } : undefined}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              disabled={column.id === 'running'}
              onOpen={() => onOpen(card.id)}
              onRun={() => onRun(card.id)}
              onHost={() => onHost(card.id)}
            />
          ))}
        </SortableContext>
        {column.id === 'running' && cards.length === 0 && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 8 }}>
            Cards enter Running only when you run them.
          </p>
        )}
      </div>
    </div>
  );
}
