// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Wordmark } from './Brand.jsx';

const LINKS = [
  ['/', 'Overview'],
  ['/payments', 'Payments'],
  ['/ledger', 'Ledger'],
  ['/webhooks', 'Webhooks'],
  ['/settlements', 'Settlements'],
  ['/reconciliation', 'Reconciliation'],
  ['/developers', 'Developers'],
];

export default function Layout() {
  const { merchant, signOut } = useAuth();
  const { pathname } = useLocation();
  const currentPage = pathname.startsWith('/payments/')
    ? 'Payment details'
    : LINKS.find(([to]) => to === pathname)?.[1] || 'Overview';

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="rail">
        <NavLink to="/" className="brand" aria-label="PayOps home"><Wordmark size={30} /></NavLink>
        <span className="nav-label">Workspace</span>
        <nav className="nav" aria-label="Main">
          {LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <span className="mode">Test mode</span>
          <div>
            <div style={{ fontWeight: 600 }}>{merchant?.name}</div>
            <div className="muted">{merchant?.email}</div>
          </div>
          <button className="btn ghost small" onClick={signOut} style={{ width: 'fit-content' }}>Sign out</button>
          <a className="credit" href="https://github.com/differentiatorX" target="_blank" rel="noreferrer">Built by differentiatorX</a>
        </div>
      </aside>
      <main className="main" id="main-content" tabIndex="-1">
        <div className="topbar">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span>PayOps</span><span aria-hidden="true">/</span><strong>{currentPage}</strong>
          </nav>
          <span className="environment-pill">Simulated environment</span>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
