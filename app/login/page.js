"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/app/design/icons';
import css from './login.module.css';

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const router = useRouter();

  const submit = async (e) => {
    e.preventDefault();
    if (!password || !email.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'Incorrect email or password');
        setLoading(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      router.replace(data?.home || '/');
      router.refresh();
    } catch (err) {
      setError('Network error, please try again');
      setLoading(false);
    }
  };

  return (
    <div className={css.page}>
      <div className={css.box}>
        {/* Worthy logo */}
        <img src="/logo-black.png" alt="Worthy" className={css.logo} />

        <div className={css.card}>
          {/* Title */}
          <h1 className={css.title}><span className={css.chip}><Icon n="grid" size={16} /></span>Worthy Accounts Dashboard</h1>
          <p className={css.sub}>
            Restricted Access. Don&apos;t try to login if you are not authorized to use this dashboard.
          </p>

          {/* Form */}
          <form onSubmit={submit} className={css.form}>
            <label htmlFor="login-email" className={css.label}><Icon n="mail" size={13} />Work email</label>
            <input
              id="login-email"
              type="email"
              autoFocus
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@worthy.nz"
              className={css.input}
            />
            <label htmlFor="login-password" className={css.label}><Icon n="users" size={13} />Department password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              className={`${css.input} ${error ? css.inputErr : ''}`}
            />
            {error && (
              <div className={css.err} role="alert"><Icon n="alert" size={14} />{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !password || !email.trim()}
              className={css.btn}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Help text */}
        <div className={css.help}>
          <span className={css.chip}><Icon n="user" size={15} /></span>
          <div>
            <div className={css.helpTitle}>Need access?</div>
            If you don&apos;t have a password yet, please contact Worthy&apos;s Digital Commerce Lead to get help logging in.
          </div>
        </div>

        <div className={css.foot}>
          Worthy · Internal Use Only
        </div>
      </div>
    </div>
  );
}
