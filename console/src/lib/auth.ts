import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool, initDatabase } from '@/db';

const JWT_SECRET = process.env.CONSOLE_JWT_SECRET || 'dev-console-secret-super-secure-key-32bytes-min';

export interface UserSession {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: string;
}

export function signSessionToken(session: UserSession): string {
  return jwt.sign(session, JWT_SECRET, { expiresIn: '7d' });
}

export function verifySessionToken(token: string): UserSession | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as UserSession;
    return payload;
  } catch {
    return null;
  }
}

export async function authenticateUser(email: string, password: string): Promise<UserSession | null> {
  await initDatabase();
  const res = await pool.query(
    'SELECT id, org_id, email, name, password_hash, role, status FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );

  if (res.rows.length === 0) {
    return null;
  }

  const user = res.rows[0];
  if (user.status !== 'active') {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    return null;
  }

  return {
    userId: user.id,
    orgId: user.org_id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export async function getUserById(userId: string): Promise<UserSession | null> {
  await initDatabase();
  const res = await pool.query(
    'SELECT id, org_id, email, name, role, status FROM users WHERE id = $1',
    [userId]
  );
  if (res.rows.length === 0 || res.rows[0].status !== 'active') {
    return null;
  }
  const u = res.rows[0];
  return {
    userId: u.id,
    orgId: u.org_id,
    email: u.email,
    name: u.name,
    role: u.role,
  };
}
