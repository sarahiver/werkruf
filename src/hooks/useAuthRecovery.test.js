import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuth } from './useAuth';

let mockAuthListener;

jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: {
    auth: {
      onAuthStateChange: jest.fn((callback) => {
        mockAuthListener = callback;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      signOut: jest.fn(),
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: {}, error: null }) })),
      })),
    })),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  },
}));

beforeEach(() => {
  window.sessionStorage.clear();
  jest.clearAllMocks();
  mockAuthListener = undefined;
});

test('erkennt PASSWORD_RECOVERY und hält den Recovery-Modus über den Auth-Status hinweg', async () => {
  const { result } = renderHook(() => useAuth());
  act(() => mockAuthListener('PASSWORD_RECOVERY', { user: { id: 'user-1' } }));
  await waitFor(() => expect(result.current.recoveryMode).toBe(true));
  expect(result.current.isAuthenticated).toBe(true);
  expect(window.sessionStorage.getItem('werkruf.password-recovery')).toBe('true');

  act(() => result.current.completePasswordRecovery());
  expect(result.current.recoveryMode).toBe(false);
  expect(window.sessionStorage.getItem('werkruf.password-recovery')).toBeNull();
});
