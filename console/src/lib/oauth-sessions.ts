export interface OAuthSession {
  mcpServerId: string;
  projectId: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  expiresAt: number;
}

// In-memory session store (with 10-minute TTL)
const sessions = new Map<string, OAuthSession>();

export function createOAuthSession(session: OAuthSession) {
  sessions.set(session.state, session);
}

export function getOAuthSession(state: string): OAuthSession | undefined {
  const session = sessions.get(state);
  if (!session) return undefined;
  if (Date.now() > session.expiresAt) {
    sessions.delete(state);
    return undefined;
  }
  return session;
}

export function consumeOAuthSession(state: string): OAuthSession | undefined {
  const session = getOAuthSession(state);
  if (session) {
    sessions.delete(state);
  }
  return session;
}
