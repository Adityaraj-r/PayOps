// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useResource } from '../hooks.js';
import { useAuth } from '../auth.jsx';
import { money, timeAgo } from '../format.js';
import { Empty, ErrorNote, Loading, StatusPill } from '../components/ui.jsx';
import VolumeChart from '../components/VolumeChart.jsx';
import CreatePaymentModal from '../components/CreatePaymentModal.jsx';

export default function Overview() {
  const { data, error, reload, loading } = useResource('/overview', { pollMs: 5000 });
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const { merchant } = useAuth();
  const feePct = ((merchant?.fee_bps ?? 200) / 100).toFixed(2).replace(/\.?0+$/, '');

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
              <h2>Payment outcomes</h2>
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
                    <tr><th className="amount">Amount</th><th>Status</th><th>Customer</th><th>Created</th></tr>
                  </thead>
                  <tbody>
                    {data.recent_payments.map((p) => (
                      <tr key={p.id} className="clickable" onClick={() => nav(`/payments/${p.id}`)}>
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
