/**
 * Makes a personal access code for each rep (or for the keys you name) and writes
 * two files to the folder you pass, OUTSIDE the repo:
 *   rep-access-codes.txt   one line per rep: who gets which code (hand these out individually)
 *   rep-access-env.json    the value for the REP_ACCESS environment variable (salted hashes only)
 * Nothing secret is printed to the screen.
 *
 *   node scripts/make-rep-codes.mjs "C:\path\to\private\folder" [jerry savan ...]
 *
 * To switch one rep off later: remove their entry from REP_ACCESS (or raise their "ver") and redeploy.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPS, hashCode } from '../lib/repAccess.js';

const [dir, ...only] = process.argv.slice(2);
if (!dir) { console.error('Usage: node scripts/make-rep-codes.mjs <private folder> [rep keys]'); process.exit(1); }
if (existsSync(join(dir, 'rep-access-codes.txt'))) { console.error('Refusing to overwrite existing codes in that folder.'); process.exit(1); }
mkdirSync(dir, { recursive: true });

const chosen = only.length ? REPS.filter((r) => only.includes(r.key)) : REPS;
const env = {}, lines = [];
for (const rep of chosen) {
  const code = randomBytes(18).toString('base64url');       // 24 characters, 144 bits
  const salt = randomBytes(8).toString('hex');
  env[rep.key] = { salt, hash: hashCode(code, salt), ver: 1 };
  lines.push(`${rep.label} (${rep.system === 'north' ? 'North' : 'South'})\t${code}`);
}
writeFileSync(join(dir, 'rep-access-codes.txt'), lines.join('\n') + '\n');
writeFileSync(join(dir, 'rep-access-env.json'), JSON.stringify(env));
console.log(`Wrote codes for ${chosen.length} reps to ${dir}`);
