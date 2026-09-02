import type { OutcomeCard } from '@tracksmith/shared';

interface Props {
  card: OutcomeCard;
  overlay?: boolean;
  onOpen?: () => void;
  onRun?: () => void;
  onHost?: () => void;
}

export function CardView({ card, overlay, onOpen, onRun, onHost }: Props) {
  return (
    <div className="card" style={overlay ? { cursor: 'grabbing', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' } : undefined}>
      <p className="card-title">{card.title}</p>
      <p className="card-summary">{card.summary}</p>
      <div className="card-meta">
        <span className="pill">{card.engine}</span>
        {card.resolvedEngine && card.engine === 'auto' && (
          <span className="pill pill-resolved">→ {card.resolvedEngine}</span>
        )}
      </div>
      {card.failureReason && card.column === 'todo' && (
        <div className="banner-warn" style={{ marginBottom: 8, fontSize: '0.7rem' }}>
          {card.failureReason}
        </div>
      )}
      <div className="card-actions">
        {(card.column === 'todo' || card.column === 'backlog') && onRun && (
          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); onRun(); }}>
            Run
          </button>
        )}
        {onOpen && (
          <button className="btn" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
            Details
          </button>
        )}
        {onHost && card.runRef && (
          <button className="btn" onClick={(e) => { e.stopPropagation(); onHost(); }}>
            Open in Host
          </button>
        )}
      </div>
    </div>
  );
}
