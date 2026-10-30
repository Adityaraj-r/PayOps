// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
import { useEffect, useRef, useState } from 'react';
import { money, statusLabel, statusTone } from '../format.js';

export const StatusPill = ({ status, label }) => <span className={`pill ${statusTone(status)}`}>{label || statusLabel(status)}</span>;

export const Money = ({ value, className = '' }) => <span className={`num ${className}`}>{money(value)}</span>;

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading({ children = 'Loading…' }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-line" aria-hidden="true" />
      <span className="loading-line short" aria-hidden="true" />
      <span className="loading-label">{children}</span>
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="notice bad" role="alert">{error.message}</div>;
}

export function Modal({ title, onClose, children }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const focusables = () => [...dialogRef.current.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    focusables()[0]?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === items[0]) {
        e.preventDefault();
        items.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
        e.preventDefault();
        items[0].focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus?.();
    };
  }, []);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="panel-head">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CopyText({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyError('');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError('Clipboard unavailable. Select the value and copy it manually.');
    }
  };
  return (
    <span className="copy-control">
      <button type="button" className="btn ghost small" onClick={copy}>
        {copied ? 'Copied' : label}
      </button>
      <span className="copy-feedback" role="status" aria-live="polite">{copyError}</span>
    </span>
  );
}
