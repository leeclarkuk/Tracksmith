import { useState } from 'react';
import type { OutcomeCard } from '@tracksmith/shared';
import { api } from './api';

type Tab = 'result' | 'goal' | 'artifacts' | 'changes' | 'audit';

interface Props {
  card: OutcomeCard;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export function DetailDrawer({ card, onClose, onRefresh }: Props) {
  const [tab, setTab] = useState<Tab>('result');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const packet = card.resultPacket;
  const isRunning = card.column === 'running';

  async function handleCorrect() {
    if (!instruction.trim() || isRunning) return;
    setBusy(true);
    try {
      await api.correctCard(card.id, instruction.trim());
      setInstruction('');
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function openHost() {
    const { url } = await api.hostUrl(card.id);
    window.open(url, '_blank');
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-header">
          <div>
            <h2>{card.title}</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              {card.resolvedEngine ?? card.engine}
              {card.runRef?.slotId && ` · slot ${card.runRef.slotId.slice(0, 8)}`}
              {card.runRef?.taskId && ` · task ${card.runRef.taskId.slice(0, 8)}`}
            </p>
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        <div className="drawer-tabs">
          {(['result', 'goal', 'artifacts', 'changes', 'audit'] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'result' ? 'Result' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          <button className="tab" onClick={openHost} style={{ marginLeft: 'auto' }}>
            Open Host
          </button>
        </div>

        <div className="drawer-body">
          {card.failureReason && card.column !== 'running' && (
            <div className="banner-warn">{card.failureReason}</div>
          )}

          {tab === 'result' && (
            <>
              {packet ? (
                <>
                  <div className="drawer-section">
                    <h3>Final summary</h3>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{packet.finalSummary}</p>
                  </div>
                  <div className="drawer-section">
                    <h3>Checks</h3>
                    {packet.checks.map((c, i) => (
                      <div key={i} className="check-row">
                        <span className={c.passed ? 'check-pass' : 'check-fail'}>{c.passed ? '✓' : '✗'}</span>
                        <div>
                          <strong>{c.name}</strong>
                          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>{c.evidence}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="drawer-section">
                    <h3>Artifacts</h3>
                    {packet.artifacts.map((a, i) => (
                      <a key={i} className="artifact-link" href={a.kind === 'url' ? a.value : undefined} target="_blank" rel="noreferrer">
                        [{a.kind}] {a.label}
                      </a>
                    ))}
                  </div>
                  {packet.risks.length > 0 && (
                    <div className="drawer-section">
                      <h3>Risks</h3>
                      <ul>{packet.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    </div>
                  )}
                  <div className="drawer-section">
                    <h3>Next actions</h3>
                    <ul>{packet.nextActions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </div>
                </>
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>
                  {isRunning ? 'Agent is working…' : 'No result yet. Run the card to produce an outcome packet.'}
                </p>
              )}
            </>
          )}

          {tab === 'goal' && (
            <div className="drawer-section">
              <h3>Prompt</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{card.prompt}</p>
              {card.goalContract && (
                <>
                  <h3 style={{ marginTop: 16 }}>Goal contract</h3>
                  <p>Continue until verified: {card.goalContract.continueUntilVerified ? 'yes' : 'no'}</p>
                  <p>Attempts: {card.goalContract.attemptCount} / {card.goalContract.maxAttempts}</p>
                  <ul>
                    {card.goalContract.acceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </>
              )}
            </div>
          )}

          {tab === 'artifacts' && (
            <div className="drawer-section">
              {card.evidence.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No durable evidence yet.</p>
              ) : (
                card.evidence.map((e) => (
                  <div key={e.id} className="artifact-link">
                    [{e.kind}] {e.label}: {e.value}
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}> · {new Date(e.createdAt).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'changes' && (
            <div className="drawer-section">
              {[
                ...card.evidence.filter((e) => e.kind === 'commit' || e.kind === 'branch' || e.kind === 'path'),
                ...(packet?.artifacts ?? []).filter(
                  (a) => a.kind === 'commit' || a.kind === 'branch' || a.kind === 'path',
                ),
              ].map((e, i) => (
                <div key={i} className="artifact-link">
                  {e.label}: {e.value}
                </div>
              ))}
              {card.evidence.filter((e) => e.kind === 'commit' || e.kind === 'branch' || e.kind === 'path').length === 0 && (
                <p style={{ color: 'var(--text-muted)' }}>No change artifacts recorded.</p>
              )}
            </div>
          )}

          {tab === 'audit' && (
            <div className="drawer-section">
              {card.audit.map((a) => (
                <div key={a.id} className="audit-entry">
                  <strong>{a.kind}</strong> · {new Date(a.at).toLocaleString()}
                  <br />{a.message}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <textarea
            placeholder={isRunning ? 'Agent is working…' : 'Reply with a correction or next instruction'}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={isRunning || busy}
          />
          <button className="btn btn-primary" disabled={isRunning || busy || !instruction.trim()} onClick={handleCorrect}>
            Send
          </button>
        </div>
      </aside>
    </>
  );
}
