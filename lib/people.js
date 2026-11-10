/**
 * WHO MAY USE WHAT. One list of named people per department, so access is granted to a person, not just to whoever
 * knows a department password. Edge-safe (plain data), because the middleware reads it.
 *
 *   dept       mgmt (Management), bdm (Business Development & Marketing), purch (Purchasing & Stock)
 *   dashboard  may sign in to the dashboard pages (and the dashboard chat, which runs on Worthy's AI key)
 *   connector  may connect the department connector (/api/mcp) in their OWN Claude or ChatGPT account (they pay for that AI use)
 *
 * A person signs in with their work email and their department's password. Remove a person here (or set a flag to
 * false) and their dashboard sign-in and any connector token issued to them stop working on the next request.
 *
 * NOT in this list, on purpose:
 *   - Team leads (Michelle, Team 1 lead): they use the My Account page with their own email and access code (lib/repAccess.js).
 *   - Vishva Dave and future business development staff: they use the rep-only connector with their own email and
 *     access code (lib/repAccess.js, role "marketing"), which never shows individual rep or weekly revenue.
 *     Nobody is listed under bdm here, so the BDM department password opens nothing until a person is added.
 *
 * To add someone: add a line, deploy. Nothing else to configure.
 */
export const PEOPLE = [
  { key: 'kishan',  name: 'Kishan',  email: 'kishan@worthy.nz',  dept: 'mgmt',  dashboard: true, connector: true },
  { key: 'jainesh', name: 'Jainesh', email: 'jainesh@worthy.nz', dept: 'mgmt',  dashboard: true, connector: true },
  { key: 'lakmal',  name: 'Lakmal',  email: 'lakmal@worthy.nz',  dept: 'mgmt',  dashboard: true, connector: true },
  { key: 'hetal',   name: 'Hetal',   email: 'hetal@worthy.nz',   dept: 'mgmt',  dashboard: true, connector: true },
  { key: 'pratham', name: 'Pratham', email: 'pratham@worthy.nz', dept: 'mgmt',  dashboard: true, connector: true },   // runs the dashboard
  { key: 'kylie',   name: 'Kylie',   email: 'kylie@worthy.nz',   dept: 'purch', dashboard: true, connector: false },  // dashboard and its chat only
  { key: 'hari',    name: 'Hari',    email: 'hari@worthy.nz',    dept: 'purch', dashboard: true, connector: true },
];

// Test-only people, so the automated access tests can sign in to every department. They exist ONLY when
// PEOPLE_ALLOW_TEST=1 (local tests; never set in production), the same idea as REP_ALLOW_TEST_LEAD.
const TEST_PEOPLE = [
  { key: 'testmgmt',  name: 'Test Management', email: 'test.mgmt@worthy.nz',  dept: 'mgmt',  dashboard: true, connector: true, test: true },
  { key: 'testbdm',   name: 'Test BDM',        email: 'test.bdm@worthy.nz',   dept: 'bdm',   dashboard: true, connector: true, test: true },
  { key: 'testpurch', name: 'Test Purchasing', email: 'test.purch@worthy.nz', dept: 'purch', dashboard: true, connector: true, test: true },
  { key: 'testdash',  name: 'Test Dashboard Only', email: 'test.dash@worthy.nz', dept: 'purch', dashboard: true, connector: false, test: true },
];
const everyone = () => (process.env.PEOPLE_ALLOW_TEST === '1' ? [...PEOPLE, ...TEST_PEOPLE] : PEOPLE);

const norm = (s) => String(s || '').trim().toLowerCase();

export const personByKey = (key) => everyone().find((p) => p.key === key) || null;
export const personByEmail = (email) => { const e = norm(email); return e ? everyone().find((p) => p.email === e) || null : null; };

/** The person, only if they are still listed in that department and allowed that way in ('dashboard' or 'connector'). */
export function personFor(key, dept, via) {
  const p = personByKey(key);
  return p && p.dept === dept && p[via] === true ? p : null;
}
export const peopleWho = (via) => everyone().filter((p) => p[via] === true);
