import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.ASHWINI_DB_PATH ? path.resolve(process.env.ASHWINI_DB_PATH) : path.join(__dirname, 'ashwini.db');
if (!fs.existsSync(dbPath)) { console.error(`Database not found: ${dbPath}`); process.exit(1); }

const db = new Database(dbPath);
const rl = readline.createInterface({ input, output });
const ask = async (q) => (await rl.question(q)).trim();

try {
  const admins = db.prepare("SELECT id,name,email,role FROM users WHERE role='admin' ORDER BY id").all();
  console.log('\nAshwini V54 Admin Recovery');
  console.log(`Database: ${dbPath}`);
  console.log(`Existing admin accounts: ${admins.length}`);
  admins.forEach((a,i)=>console.log(`  ${i+1}. ${a.email} (${a.name})`));

  let email = admins[0]?.email || '';
  if (admins.length) {
    const chosen = await ask(`Admin email [${email}]: `);
    if (chosen) email = chosen.toLowerCase();
  } else {
    email = (await ask('New admin email: ')).toLowerCase();
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Invalid admin email');
  const name = admins.length ? null : await ask('New admin name: ');
  const password = await ask('New admin password (8+ characters): ');
  const confirm = await ask('Confirm new admin password: ');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  if (password !== confirm) throw new Error('Passwords do not match');

  const backup = path.join(__dirname, `ashwini-admin-backup-${Date.now()}.db`);
  fs.copyFileSync(dbPath, backup);
  console.log(`Backup created: ${backup}`);

  const hash = await bcrypt.hash(password, 12);
  const existing = db.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(email);
  if (existing) {
    db.prepare("UPDATE users SET password_hash=?,role='admin' WHERE id=?").run(hash, existing.id);
    db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(existing.id);
    console.log('SUCCESS: Admin password reset.');
  } else {
    const r = db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run(name || 'Ashwini Admin', email, hash);
    console.log(`SUCCESS: Admin account created (ID ${r.lastInsertRowid}).`);
  }
  console.log('Your products/customers/orders database was not reset.');
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
  db.close();
}
