import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuth } from './useAuth';
import supabase from '../supabaseClient';

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
  // The full CI run can reset a shared Jest mock implementation between
  // suites. Restore this suite's contract explicitly instead of relying on
  // module-factory initialization order.
  supabase.auth.onAuthStateChange.mockImplementation((callback) => {
    mockAuthListener = callback;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
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
