import { NextRequest } from 'next/server';
import { verifySessionToken, UserSession } from './auth';

export function getSessionFromRequest(req: NextRequest): UserSession | null {
  let token = req.cookies.get('gateway_console_session')?.value;
  if (!token) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }
  if (!token) return null;
  return verifySessionToken(token);
}
