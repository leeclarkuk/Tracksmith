import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useEffect, useMemo, useState } from 'react';
import type { Column, Engine, OutcomeCard } from '@tracksmith/shared';
import { COLUMNS, canTransitionColumn } from '@tracksmith/shared';
import { api, subscribeCards } from './api';
import { BoardColumn } from './BoardColumn';
import { CardView } from './CardView';
import { DetailDrawer } from './DetailDrawer';

export default function App() {
  const [cards, setCards] = useState<OutcomeCard[]>([]);
  const [prompt, setPrompt] = useState('');
  const [engine, setEngine] = useState<Engine>('auto');
  const [targetColumn, setTargetColumn] = useState<'todo' | 'backlog'>('todo');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [continueUntilVerified, setContinueUntilVerified] = useState(false);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [maxWallClock, setMaxWallClock] = useState(3600);
  const [maxTokens, setMaxTokens] = useState(500000);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const selected = useMemo(() => cards.find((c) => c.id === selectedId), [cards, selectedId]);
  const activeCard = useMemo(() => cards.find((c) => c.id === activeId), [cards, activeId]);

  const refresh = () => api.listCards().then(setCards).catch(console.error);

  useEffect(() => {
    refresh();
    return subscribeCards(setCards);
  }, []);

  const cardsByColumn = useMemo(() => {
    const map: Record<Column, OutcomeCard[]> = {
      backlog: [],
      todo: [],
      running: [],
      done: [],
      failed: [],
    };
    for (const c of cards) map[c.column].push(c);
    return map;
  }, [cards]);

  async function handleCreate() {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      await api.createCard({
        prompt: prompt.trim(),
        engine,
        column: targetColumn,
        goalContract: continueUntilVerified
          ? {
              acceptanceCriteria: acceptanceCriteria
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean),
              maxAttempts,
              maxWallClockSeconds: maxWallClock,
              maxTokenBudget: maxTokens,
              continueUntilVerified: true,
            }
          : undefined,
      });
      setPrompt('');
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const cardId = String(active.id);
    const toColumn = String(over.id) as Column;
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.column === toColumn) return;
    if (!canTransitionColumn(card.column, toColumn)) return;
    try {
      await api.moveColumn(cardId, toColumn);
      await refresh();
    } catch (err) {
      console.error(err);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Tracksmith</h1>
        <p>Outcome-first Kanban for agent work on KiroCrew</p>
      </header>

      <div className="create-bar">
        <textarea
          placeholder="Describe the outcome you want. Nothing runs until you say so."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="create-controls">
          <select value={engine} onChange={(e) => setEngine(e.target.value as Engine)}>
            <option value="auto">Auto</option>
            <option value="chat">Chat</option>
            <option value="task_runner">Task Runner</option>
            <option value="autopilot">Autopilot</option>
          </select>
          <select value={targetColumn} onChange={(e) => setTargetColumn(e.target.value as 'todo' | 'backlog')}>
            <option value="todo">To do</option>
            <option value="backlog">Backlog</option>
          </select>
          <button className="btn btn-primary" disabled={loading || !prompt.trim()} onClick={handleCreate}>
            Add to board
          </button>
        </div>
      </div>

      <div className="goal-fields" style={{ padding: '0 24px 12px', background: 'var(--surface)' }}>
        <label className="toggle-row">
          <input type="checkbox" checked={continueUntilVerified} onChange={(e) => setContinueUntilVerified(e.target.checked)} />
          Continue until verified (goal contract)
        </label>
        {continueUntilVerified && (
          <>
            <label>
              Acceptance criteria (one per line)
              <textarea value={acceptanceCriteria} onChange={(e) => setAcceptanceCriteria(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label>
                Max attempts
                <input type="number" min={1} value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))} />
              </label>
              <label>
                Wall-clock (seconds)
                <input type="number" min={60} value={maxWallClock} onChange={(e) => setMaxWallClock(Number(e.target.value))} />
              </label>
              <label>
                Token budget
                <input type="number" min={1000} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
              </label>
            </div>
          </>
        )}
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="board">
          {COLUMNS.map((col) => (
            <BoardColumn
              key={col.id}
              column={col}
              cards={cardsByColumn[col.id]}
              onOpen={(id) => setSelectedId(id)}
              onRun={async (id) => {
                await api.runCard(id);
                await refresh();
              }}
              onHost={async (id) => {
                const { url } = await api.hostUrl(id);
                window.open(url, '_blank');
              }}
            />
          ))}
        </div>
        <DragOverlay>{activeCard ? <CardView card={activeCard} overlay /> : null}</DragOverlay>
      </DndContext>

      {selected && (
        <DetailDrawer
          card={selected}
          onClose={() => setSelectedId(null)}
          onRefresh={refresh}
        />
      )}

      <div className="schedule-note">
        Need a card on a schedule? Use KiroCrew&apos;s Schedule tab: <code>kirocrew cron add</code> with the card&apos;s prompt. Tracksmith does not duplicate the Host cron surface.
      </div>
    </div>
  );
}
