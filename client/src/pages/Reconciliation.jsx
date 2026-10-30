// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useResource } from '../hooks.js';
import { dateTime, money } from '../format.js';
import { Empty, ErrorNote, Loading } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

const BUCKETS = [
  ['amount_mismatch', 'Amounts differ'],
  ['status_mismatch', 'Statuses differ'],
  ['missing_at_provider', 'Captured here, unknown to the bank'],
];

export default function Reconciliation() {
  const { merchant } = useAuth();
  const { data, error, reload, loading } = useResource('/reconciliation');
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState(null);

  const run = async () => {
    setBusy(true);
    setRunError(null);
    try {
      await api.post('/reconciliation/run');
      await reload();
    } catch (err) {
      setRunError(err);
    } finally {
      setBusy(false);
    }
  };

  const latest = data?.data[0];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reconciliation</h1>
          <p className="lede">Shows provider and ledger reconciliation findings for your account. Platform reconciliation runs on the worker schedule.</p>
        </div>
        {merchant?.can_run_platform_reconciliation && <button className="btn" onClick={run} disabled={busy}>{busy ? 'Comparing…' : 'Run platform reconciliation'}</button>}
      </div>
      <ErrorNote error={error || runError} />

      {loading && !data ? (
        <section className="panel"><Loading>Loading reconciliation history…</Loading></section>
      ) : latest ? (
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Latest run</h2>
              <span className="muted small">{dateTime(latest.created_at)}, {latest.trigger === 'manual' ? 'run by you' : 'scheduled'}</span>
            </div>
            {latest.issue_count === 0 && latest.ledger?.balanced !== false ? (
              <div className="notice good">Provider payment records match, and your ledger balances.</div>
            ) : (
              <div className="notice bad">{latest.issue_count} payment{latest.issue_count === 1 ? '' : 's'} need a look{latest.ledger?.balanced === false ? ', and the ledger has drift' : ''}.</div>
            )}
            <dl className="facts" style={{ marginTop: 14 }}>
              <dt>Payments matched for your account</dt><dd className="num">{latest.matched_count ?? 'Not recorded in this older report'}</dd>
              <dt>Ledger</dt><dd>{latest.ledger ? (latest.ledger.balanced ? `Balanced at ${money(latest.ledger.totalDebits)} each side` : `Drift in ${latest.ledger.driftAccounts.join(', ')}`) : 'No entries yet'}</dd>
            </dl>
            {latest.issues_truncated && <p className="muted small">Showing a limited sample of payment issues. The counts above include all detected issues for your account.</p>}
          </section>
          {BUCKETS.map(([key, label]) =>
            latest.issues[key].length ? (
              <section className="panel" key={key}>
                <h2>{label}</h2>
                <table>
                  <thead><tr><th>Payment</th><th>Ours</th><th>Bank</th></tr></thead>
                  <tbody>
                    {latest.issues[key].map((i) => (
                      <tr key={i.paymentId}>
                        <td><Link to={`/payments/${i.paymentId}`}>{i.paymentId}</Link></td>
                        <td>{i.ourStatus}, {money(i.ourAmount)}</td>
                        <td>{i.providerStatus || 'no record'}{i.providerAmount != null ? `, ${money(i.providerAmount)}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null,
          )}
        </div>
      ) : (
        data && <section className="panel"><Empty title="No runs yet">The worker runs reconciliation on its configured schedule.</Empty></section>
      )}
    </>
  );
}
