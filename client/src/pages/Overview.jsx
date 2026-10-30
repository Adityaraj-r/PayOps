// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../hooks.js';
import { useAuth } from '../auth.jsx';
import { dateTime, EVENT_LABELS, money, timeAgo } from '../format.js';
import { Empty, ErrorNote, Loading, StatusPill } from '../components/ui.jsx';
import VolumeChart from '../components/VolumeChart.jsx';
import CreatePaymentModal from '../components/CreatePaymentModal.jsx';

export default function Overview() {
  const { data, error, reload, loading } = useResource('/overview', { pollMs: 5000 });
  const webhooks = useResource('/webhooks');
  const ledger = useResource('/ledger');
  const settlements = useResource('/settlements');
  const [creating, setCreating] = useState(false);
  const { merchant } = useAuth();
  const feePct = ((merchant?.fee_bps ?? 200) / 100).toFixed(2).replace(/\.?0+$/, '');
  const counts = data?.status_counts || {};
  const totalPayments = Object.values(counts).reduce((total, count) => total + count, 0);
  const capturedPayments = ['captured', 'partially_refunded', 'refunded'].reduce((total, status) => total + (counts[status] || 0), 0);
  const pendingPayments = ['created', 'processing', 'authorized'].reduce((total, status) => total + (counts[status] || 0), 0);
  const recentDeliveries = webhooks.data?.deliveries || [];
  const deliveryCounts = recentDeliveries.reduce((result, delivery) => {
    result[delivery.status] = (result[delivery.status] || 0) + 1;
    return result;
  }, {});
  const recentJournal = ledger.data?.journal?.slice(0, 5) || [];
  const recentSettlements = settlements.data?.data?.slice(0, 3) || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="lede">Last 14 days, in Indian time. Balances come straight from the ledger.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>Create test payment</button>
      </div>
      <ErrorNote error={error} />
      {loading && !data && <section className="panel"><Loading>Loading overview…</Loading></section>}

      {data && (
        <>
          <section className="metric-grid" aria-label="Payment activity, last 14 days">
            <MetricCard label="Payments" value={totalPayments} note="Created in the last 14 days" />
            <MetricCard label="Captured" value={capturedPayments} note="Includes later-refunded payments" tone="good" />
            <MetricCard label="Failed" value={counts.failed || 0} note="Created in this period" tone="bad" />
            <MetricCard label="Pending" value={pendingPayments} note="Created, processing, or authorized" tone="wait" />
          </section>

          <section className="figures" aria-label="Balances">
            <div className="figure">
              <div className="label">Merchant payable (simulated)</div>
              <div className="value">{money(data.balances.unsettled)}</div>
              <div className="hint">Current ledger balance</div>
            </div>
            <div className="figure">
              <div className="label">Simulated payouts recorded</div>
              <div className="value">{money(data.balances.paid_out)}</div>
              <div className="hint">Sum of simulated settlement records</div>
            </div>
            <div className="figure">
              <div className="label">Fees recorded</div>
              <div className="value">{money(data.balances.fees_paid)}</div>
              <div className="hint">{feePct}% fee recorded on captures</div>
            </div>
          </section>
          <p className="muted small">These are simulation ledger figures. Settlement allocation does not yet trace every swept amount to eligible payments.</p>

          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <h2>Captured volume</h2>
                <span className="muted small num">{money(data.captured_volume)} in 14 days</span>
              </div>
              <VolumeChart series={data.volume} />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Payment outcomes</h2>
                <span className="muted small">14 days</span>
              </div>
              <dl className="facts">
                <dt>Capture rate</dt>
                <dd className="num">{data.success_rate == null ? 'No captured or failed payments in this period' : `${(data.success_rate * 100).toFixed(1)}% of captured or failed payments created in this period`}</dd>
                {Object.entries(data.status_counts).map(([status, count]) => (
                  <FactRow key={status} status={status} count={count} />
                ))}
              </dl>
            </section>
          </div>

          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head">
              <h2>Recent payments</h2>
              <Link to="/payments" className="small">All payments</Link>
            </div>
            {data.recent_payments.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Payment</th><th className="amount">Amount</th><th>Status</th><th>Customer</th><th>Created</th></tr>
                  </thead>
                  <tbody>
                    {data.recent_payments.map((p) => (
                      <tr key={p.id}>
                        <td><Link className="code table-id" to={`/payments/${p.id}`} title={p.id}>{p.id}</Link></td>
                        <td className="amount">{money(p.amount)}</td>
                        <td><StatusPill status={p.status} /></td>
                        <td>{p.customer?.email}</td>
                        <td className="muted">{timeAgo(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No payments yet">Create a test payment, or run <span className="code">npm run seed</span> for realistic traffic.</Empty>
            )}
          </section>

          <div className="operations-grid">
            <section className="panel">
              <div className="panel-head">
                <h2>Webhook deliveries</h2>
                <Link to="/webhooks" className="small">Monitor</Link>
              </div>
              <p className="muted small">At-least-once delivery. Status counts cover the latest {recentDeliveries.length === 100 ? '100' : recentDeliveries.length} records returned.</p>
              {webhooks.loading && !webhooks.data ? <Loading>Loading delivery activity…</Loading> : webhooks.error ? <ErrorNote error={webhooks.error} /> : webhooks.data ? (
                <>
                  <div className="metric-inline">
                    <span><strong>{deliveryCounts.succeeded || 0}</strong> delivered</span>
                    <span><strong>{(deliveryCounts.pending || 0) + (deliveryCounts.processing || 0) + (deliveryCounts.retrying || 0)}</strong> active/retrying</span>
                    <span><strong>{(deliveryCounts.dead || 0) + (deliveryCounts.failed || 0)}</strong> stopped</span>
                  </div>
                  {recentDeliveries.length ? <div className="mini-list">
                    {recentDeliveries.slice(0, 4).map((delivery) => (
                      <div className="mini-row" key={delivery.id}>
                        <div className="mini-title">{EVENT_LABELS[delivery.event_type] || delivery.event_type}
                          <div className="mini-detail"><span className="code">{delivery.id}</span> · {timeAgo(delivery.attempts.at(-1)?.at || delivery.created_at)}</div>
                        </div>
                        <StatusPill status={delivery.status} />
                      </div>
                    ))}
                  </div> : <Empty title="No deliveries yet">Delivery records appear after an event is generated.</Empty>}
                </>
              ) : null}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Recent ledger activity</h2>
                <Link to="/ledger" className="small">View ledger</Link>
              </div>
              <p className="muted small">Simulated double-entry ledger. Posted entries are append-only through the application.</p>
              {ledger.loading && !ledger.data ? <Loading>Loading ledger activity…</Loading> : ledger.error ? <ErrorNote error={ledger.error} /> : ledger.data ? (
                recentJournal.length ? <div className="mini-list">
                  {recentJournal.map((entry) => {
                    const debit = entry.lines.filter((line) => line.direction === 'debit').reduce((total, line) => total + line.amount, 0);
                    return <div className="mini-row" key={entry.id}>
                      <div className="mini-title">{entry.type.replace(/_/g, ' ')}
                        <div className="mini-detail"><span className="code">{entry.ref}</span> · {dateTime(entry.created_at)}</div>
                      </div>
                      <span className="mini-value">{money(debit)}</span>
                    </div>;
                  })}
                </div> : <Empty title="No journal entries">Entries appear after a payment is captured or refunded.</Empty>
              ) : null}
            </section>

            <section className="panel operation-wide">
              <div className="panel-head">
                <h2>Settlement simulation</h2>
                <Link to="/settlements" className="small">History</Link>
              </div>
              <p className="muted small">No funds are transferred. Allocation does not yet trace every swept amount to eligible payments.</p>
              {settlements.loading && !settlements.data ? <Loading>Loading settlement activity…</Loading> : settlements.error ? <ErrorNote error={settlements.error} /> : settlements.data ? (
                recentSettlements.length ? <div className="mini-list">
                  {recentSettlements.map((settlement) => (
                    <div className="mini-row" key={settlement.id}>
                      <div className="mini-title"><span className="code">{settlement.id}</span>
                        <div className="mini-detail">{dateTime(settlement.created_at)} · {settlement.payment_count} payments · simulated</div>
                      </div>
                      <div className="mini-value">{money(settlement.payout)}</div>
                    </div>
                  ))}
                </div> : <Empty title="No simulated settlements">Eligible payment activity will appear here after a settlement run.</Empty>
              ) : null}
            </section>

          </div>
        </>
      )}
      {creating && <CreatePaymentModal onClose={() => setCreating(false)} onCreated={reload} />}
    </>
  );
}

const FactRow = ({ status, count }) => (
  <>
    <dt><StatusPill status={status} /></dt>
    <dd className="num">{count}</dd>
  </>
);

function MetricCard({ label, value, note, tone }) {
  return (
    <div className={`metric-card${tone ? ` metric-${tone}` : ''}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value.toLocaleString('en-IN')}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}
