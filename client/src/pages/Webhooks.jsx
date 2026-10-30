// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useResource } from '../hooks.js';
import { EVENT_LABELS, dateTime, timeAgo } from '../format.js';
import { CopyText, Empty, ErrorNote, Loading, Modal, StatusPill } from '../components/ui.jsx';

export default function Webhooks() {
  const [filter, setFilter] = useState('');
  const { data, error, reload, loading } = useResource(`/webhooks${filter ? `?status=${filter}` : ''}`, { pollMs: 3000 });
  const [adding, setAdding] = useState(false);
  const [revealed, setRevealed] = useState({});
  const [inspecting, setInspecting] = useState(null);
  const [actionError, setActionError] = useState(null);

  const act = async (fn) => {
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError(err);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Webhooks</h1>
          <p className="lede">We tell your server when payments and refunds change. Failed deliveries retry with growing gaps, then stop so you can replay them.</p>
        </div>
        <button className="btn" onClick={() => setAdding(true)}>Add endpoint</button>
      </div>
      <div className="notice wait operational-note">Webhook delivery is at-least-once. Your handler should be idempotent; failed deliveries retry and may be replayed from this view.</div>
      <ErrorNote error={error || actionError} />
      {loading && !data && <section className="panel"><Loading>Loading webhook endpoints and deliveries…</Loading></section>}

      {data && (
        <>
          <section className="panel">
            <h2>Endpoints</h2>
            {data.endpoints.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>URL</th><th>Events</th><th>Signing secret</th><th /></tr></thead>
                  <tbody>
                    {data.endpoints.map((e) => (
                      <tr key={e.id}>
                        <td><div className="code">{e.url}</div>{e.description && <div className="muted small">{e.description}</div>}</td>
                        <td>{e.events.includes('*') ? 'All events' : e.events.join(', ')}</td>
                        <td>
                          <div className="code">{revealed[e.id] || e.secret}</div>
                          {!revealed[e.id] ? (
                            <button className="btn ghost small" style={{ marginTop: 6 }} onClick={() => {
                              if (!window.confirm('Rotate this webhook secret? The previous secret will work for a 24-hour overlap.')) return;
                              act(async () => { const r = await api.post(`/webhooks/endpoints/${e.id}/rotate`); setRevealed((x) => ({ ...x, [e.id]: r.secret })); });
                            }}>Rotate secret</button>
                          ) : (
                            <div style={{ marginTop: 6 }}><CopyText value={revealed[e.id]} /></div>
                          )}
                        </td>
                        <td><button className="btn danger small" onClick={() => {
                          if (window.confirm('Remove this webhook endpoint? Future events will no longer be sent to it.')) act(() => api.del(`/webhooks/endpoints/${e.id}`));
                        }}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No endpoints">Add one to start receiving events.</Empty>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Recent deliveries</h2>
              <div className="segments" role="group" aria-label="Filter deliveries">
                <button aria-pressed={filter === ''} onClick={() => setFilter('')}>All</button>
                <button aria-pressed={filter === 'failing'} onClick={() => setFilter('failing')}>Failing</button>
              </div>
            </div>
            {data.deliveries.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Delivery</th><th>Event / object</th><th>Status</th><th>Attempts / last attempt</th><th>Last response</th><th /></tr></thead>
                  <tbody>
                    {data.deliveries.map((d) => (
                      <tr key={d.id}>
                        <td><span className="code table-id" title={d.id}>{d.id}</span></td>
                        <td>
                          {EVENT_LABELS[d.event_type] || d.event_type}
                          <div className="table-subtext">{d.object_id?.startsWith('pay_') ? <Link to={`/payments/${d.object_id}`}>{d.object_id}</Link> : <span className="code">{d.object_id || '—'}</span>}</div>
                        </td>
                        <td><StatusPill status={d.status} /></td>
                        <td className="num">{d.attempt_count}<div className="table-subtext">{d.attempts.at(-1)?.at ? timeAgo(d.attempts.at(-1).at) : 'No attempt yet'}</div></td>
                        <td className="small">{d.attempts.at(-1)?.status_code ? `HTTP ${d.attempts.at(-1).status_code}` : d.attempts.at(-1)?.error || d.last_error || 'No response recorded'}</td>
                        <td>
                          <div className="row">
                            <button className="btn ghost small" onClick={() => setInspecting(d)}>Attempts</button>
                            {['dead', 'failed'].includes(d.status) && <button className="btn ghost small" onClick={() => {
                              if (window.confirm('Replay this failed delivery? The endpoint may receive the event again, so it must handle duplicate events safely.')) act(() => api.post(`/webhooks/deliveries/${d.id}/replay`));
                            }}>Replay</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title={filter ? 'Nothing failing' : 'No deliveries yet'}>{filter ? 'Every webhook reached its endpoint.' : 'Deliveries appear after a payment changes state.'}</Empty>
            )}
          </section>
        </>
      )}

      {adding && <AddEndpoint onClose={() => setAdding(false)} onAdded={reload} />}
      {inspecting && (
        <Modal title="Delivery attempts" onClose={() => setInspecting(null)}>
          <p className="muted small" style={{ marginTop: 0 }}>Delivery <span className="code">{inspecting.id}</span><br />Event <span className="code">{inspecting.event_id}</span> to <span className="code">{inspecting.url}</span></p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Try</th><th>When</th><th>Response</th><th className="amount">Time</th></tr></thead>
              <tbody>
                {inspecting.attempts.map((a, i) => (
                  <tr key={i}>
                    <td className="num">{a.attempt_number}</td>
                    <td>{dateTime(a.at)}</td>
                    <td>{a.error ? <span style={{ color: 'var(--debit)' }}>{a.error}</span> : <span style={{ color: 'var(--credit)' }}>HTTP {a.status_code}</span>}</td>
                    <td className="amount" style={{ fontFamily: 'var(--sans)' }}>{a.duration_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}

function AddEndpoint({ onClose, onAdded }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    try {
      setCreated(await api.post('/webhooks/endpoints', { url, events: ['*'] }));
      onAdded();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Modal title={created ? 'Endpoint added' : 'Add an endpoint'} onClose={onClose}>
      {created ? (
        <div className="form">
          <p className="muted" style={{ margin: 0 }}>Verify every request with this signing secret. It is shown in full only once. Store it securely.</p>
          <div className="secret-box code">{created.secret}</div>
          <CopyText value={created.secret} label="Copy secret" />
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="url">URL</label>
            <input id="url" className="input" type="url" placeholder="https://example.com/onyx/webhooks" value={url} onChange={(e) => setUrl(e.target.value)} required />
            <span className="help">Tip: a webhook.site URL lets you watch requests arrive.</span>
          </div>
          <ErrorNote error={error} />
          <button className="btn">Add endpoint</button>
        </form>
      )}
    </Modal>
  );
}
