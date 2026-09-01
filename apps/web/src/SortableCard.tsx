import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { OutcomeCard } from '@tracksmith/shared';
import { CardView } from './CardView';

interface Props {
  card: OutcomeCard;
  disabled?: boolean;
  onOpen: () => void;
  onRun: () => void;
  onHost: () => void;
}

export function SortableCard({ card, disabled, onOpen, onRun, onHost }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardView card={card} onOpen={onOpen} onRun={onRun} onHost={onHost} />
    </div>
  );
}
