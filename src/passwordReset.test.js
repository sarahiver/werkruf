import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ForgotPassword, { NEUTRAL_SUCCESS } from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Login from './pages/Login';
import supabase from './supabaseClient';
import { useAuthContext } from './context/AuthContext';

jest.mock('./supabaseClient', () => ({
  __esModule: true,
  default: { auth: { resetPasswordForEmail: jest.fn(), updateUser: jest.fn() } },
}));
jest.mock('./context/AuthContext', () => ({ useAuthContext: jest.fn() }));
jest.mock('./context/IndustryContext', () => ({
  useIndustry: () => ({ brand: { logo: 'WERKRUF' } }),
}));

const authDefaults = {
  user: null,
  loading: false,
  recoveryMode: false,
  completePasswordRecovery: jest.fn(),
  isAuthenticated: false,
  signInGoogle: jest.fn(),
  signInEmail: jest.fn(),
};

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthContext.mockReturnValue({ ...authDefaults });
  window.history.replaceState({}, '', '/');
});

async function requestReset(email = 'kunde@example.com') {
  render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset-Link senden' }));
}

test('fordert eine Reset-Mail mit dedizierter Redirect-URL an', async () => {
  supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  await requestReset();
  expect(await screen.findByRole('status')).toHaveTextContent(NEUTRAL_SUCCESS);
  expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('kunde@example.com', {
    redirectTo: `${window.location.origin}/reset-password`,
  });
});

test('zeigt für eine unbekannte E-Mail denselben neutralen Zustand', async () => {
  supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'User not found' } });
  await requestReset('unbekannt@example.com');
  expect(await screen.findByRole('status')).toHaveTextContent(NEUTRAL_SUCCESS);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('zeigt das Passwortformular nur mit gültiger Recovery-Session', () => {
  useAuthContext.mockReturnValue({
    ...authDefaults,
    user: { id: 'user-1' },
    isAuthenticated: true,
    recoveryMode: true,
  });
  render(<MemoryRouter><ResetPassword /></MemoryRouter>);
  expect(screen.getByLabelText('Neues Passwort')).toBeInTheDocument();
  expect(screen.getByLabelText('Passwort bestätigen')).toBeInTheDocument();
});

test('behandelt einen ungültigen oder abgelaufenen Recovery-Link sichtbar', () => {
  render(<MemoryRouter><ResetPassword /></MemoryRouter>);
  expect(screen.getByRole('alert')).toHaveTextContent('ungültig oder abgelaufen');
  expect(screen.queryByLabelText('Neues Passwort')).not.toBeInTheDocument();
});

test('weist nicht übereinstimmende Passwörter zurück', () => {
  useAuthContext.mockReturnValue({ ...authDefaults, user: { id: 'user-1' }, recoveryMode: true });
  render(<MemoryRouter><ResetPassword /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Neues Passwort'), { target: { value: 'sicher123' } });
  fireEvent.change(screen.getByLabelText('Passwort bestätigen'), { target: { value: 'anders123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Passwort speichern' }));
  expect(screen.getByRole('alert')).toHaveTextContent('stimmen nicht überein');
  expect(supabase.auth.updateUser).not.toHaveBeenCalled();
});

test('ändert das Passwort und beendet danach den Recovery-Modus', async () => {
  const completePasswordRecovery = jest.fn();
  useAuthContext.mockReturnValue({
    ...authDefaults,
    user: { id: 'user-1' },
    recoveryMode: true,
    completePasswordRecovery,
  });
  supabase.auth.updateUser.mockResolvedValue({ error: null });
  render(<MemoryRouter><ResetPassword /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Neues Passwort'), { target: { value: 'sicher123' } });
  fireEvent.change(screen.getByLabelText('Passwort bestätigen'), { target: { value: 'sicher123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Passwort speichern' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Passwort wurde geändert');
  expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'sicher123' });
  expect(completePasswordRecovery).toHaveBeenCalledTimes(1);
});

test('normaler Login-Redirect überschreibt einen Recovery-Flow nicht', async () => {
  useAuthContext.mockReturnValue({
    ...authDefaults,
    user: { id: 'user-1' },
    isAuthenticated: true,
    recoveryMode: true,
  });
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="*" element={<><Login /><Location /></>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
});
