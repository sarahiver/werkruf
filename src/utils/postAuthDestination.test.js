import supabase from '../supabaseClient';
import { getPostAuthDestination } from './postAuthDestination';

jest.mock('../supabaseClient', () => ({
  auth: { getSession: jest.fn() },
}));

describe('post-auth routing', () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  afterEach(() => jest.resetAllMocks());

  it('keeps an active connection in the dashboard', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } } });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: true }) });
    await expect(getPostAuthDestination()).resolves.toBe('/dashboard');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer session-token');
  });

  it('sends a user without a connection to the connection step', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } } });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ connected: false }) });
    await expect(getPostAuthDestination()).resolves.toBe('/dashboard/google');
  });

  it('waits for a session and never falls through to the landing page', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(getPostAuthDestination()).resolves.toBe('/login');
    expect(fetch).not.toHaveBeenCalled();
  });
});
