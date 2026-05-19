"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const router = useRouter();

  const submit = async (e) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'Incorrect password');
        setLoading(false);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError('Network error — please try again');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#ffffff', padding: 24,
      fontFamily: "'DM Sans', system-ui, sans-serif", color: '#111827',
    }}>
      <div style={{
        width: '100%', maxWidth: 440,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32,
      }}>
        {/* Worthy logo */}
        <img src="/logo-black.png" alt="Worthy"
             style={{ height: 80, width: 'auto', objectFit: 'contain' }} />

        {/* Title */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111827', letterSpacing: '0.01em' }}>
            Worthy Accounts Dashboard
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
            Restricted Access. Don&apos;t try to login if you are not authorized to use this dashboard.
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Password
          </label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter password"
            style={{
              width: '100%', padding: '13px 16px', fontSize: 15,
              borderRadius: 10, border: error ? '1.5px solid #dc2626' : '1.5px solid #d1d5db',
              outline: 'none', background: '#fafafa', color: '#111827',
              fontFamily: 'inherit',
              transition: 'border-color 0.15s, background 0.15s',
              boxSizing: 'border-box',
            }}
            onFocus={e => { e.target.style.borderColor = '#66270F'; e.target.style.background = '#ffffff'; }}
            onBlur={e => { e.target.style.borderColor = error ? '#dc2626' : '#d1d5db'; e.target.style.background = '#fafafa'; }}
          />
          {error && (
            <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            style={{
              padding: '13px 16px', fontSize: 14, fontWeight: 700, letterSpacing: '0.04em',
              borderRadius: 10, border: 'none', cursor: (loading || !password) ? 'not-allowed' : 'pointer',
              background: (loading || !password) ? '#b78b6a' : '#66270F',
              color: '#ffffff', fontFamily: 'inherit',
              transition: 'background 0.15s, transform 0.05s',
            }}
            onMouseDown={e => { if (!loading && password) e.currentTarget.style.transform = 'translateY(1px)'; }}
            onMouseUp={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* Help text */}
        <div style={{
          marginTop: 8, padding: 18,
          background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 12,
          fontSize: 12, color: '#4b5563', lineHeight: 1.6, textAlign: 'center', width: '100%',
          boxSizing: 'border-box',
        }}>
          <div style={{ fontWeight: 700, color: '#111827', marginBottom: 4 }}>Need access?</div>
          If you don&apos;t have a password yet, please contact Worthy&apos;s Digital Commerce Lead to get help logging in.
        </div>

        <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Worthy · Internal Use Only
        </div>
      </div>
    </div>
  );
}
