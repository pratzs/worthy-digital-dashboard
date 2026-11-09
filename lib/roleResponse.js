/**
 * Wraps a dashboard data route so its JSON answer is limited to what the caller's department may see (lib/roleData.js).
 * The department comes from the `x-worthy-role` header, which middleware.js sets from the verified sign-in cookie on every
 * request and overwrites if a caller tries to send their own. A request that reaches a route with no role is treated as the
 * most restricted department.
 */
import { NextResponse } from 'next/server';
import { filterForRole, FULL_VIEW_ROLES } from '@/lib/roleData';

export function withRoleFilter(kind, handler) {
  return async function filtered(request, ctx) {
    const res = await handler(request, ctx);
    const role = request.headers.get('x-worthy-role') || 'purch';
    if (FULL_VIEW_ROLES.has(role)) return res;
    let body;
    try { body = await res.clone().json(); } catch { return res; }
    const headers = {};
    res.headers.forEach((v, k) => { if (!/^content-(length|encoding)$/i.test(k)) headers[k] = v; });
    return NextResponse.json(filterForRole(role, kind, body), { status: res.status, headers });
  };
}
