// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
import { useResource } from '../hooks.js';
import { money } from '../format.js';
import { ErrorNote, Loading } from '../components/ui.jsx';
import LedgerTAccount from '../components/LedgerTAccount.jsx';

export default function Ledger() {
  const { data, error, reload, loading } = useResource('/ledger');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ledger</h1>
          <p className="lede">
            Simulated double-entry ledger. Each journal entry books equal debits and credits; the integrity check recomputes balances from the journal.
          </p>
        </div>
        <button className="btn ghost" onClick={reload} disabled={loading}>Check integrity again</button>
      </div>
      <ErrorNote error={error} />
      <div className="notice wait ledger-disclosure">Demo accounting only. Posted entries are read-only in this interface; corrections use separate ledger entries.</div>
      {loading && !data && <section className="panel"><Loading>Loading ledger and integrity check…</Loading></section>}
      {data && (
        <div className="grid-2">
          <div className="stack">
            <section className="panel">
              <h2>Accounts</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Account</th><th>Type</th><th>Grows on</th><th className="amount">Balance</th></tr></thead>
                  <tbody>
                    {data.accounts.map((a) => (
                      <tr key={a.code}>
                        <td>{a.name}<div className="code muted">{a.code}</div></td>
                        <td>{a.type}</td>
                        <td>{a.normal_side}</td>
                        <td className="amount">{money(a.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <h2>Integrity check</h2>
              {data.integrity.balanced ? (
                <div className="notice good">All debits equal all credits, and every stored balance matches the journal.</div>
              ) : (
                <div className="notice bad">Drift found in: {data.integrity.driftAccounts.join(', ') || 'totals'}. Stored balances disagree with the journal.</div>
              )}
              <dl className="facts" style={{ marginTop: 14 }}>
                <dt>Total debits</dt><dd className="num">{money(data.integrity.totalDebits)}</dd>
                <dt>Total credits</dt><dd className="num">{money(data.integrity.totalCredits)}</dd>
              </dl>
            </section>
          </div>
          <section className="panel">
            <div className="panel-head">
              <h2>Journal</h2>
              <span className="muted small">Latest 50 entries</span>
            </div>
            <LedgerTAccount entries={[...data.journal].reverse()} />
          </section>
        </div>
      )}
    </>
  );
}
