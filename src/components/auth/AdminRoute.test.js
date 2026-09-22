import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import AdminRoute from './AdminRoute';

jest.mock('../../context/AuthContext', () => ({
  useAuthContext: jest.fn(),
}));

const { useAuthContext } = require('../../context/AuthContext');

function renderWithAuth(auth) {
  useAuthContext.mockReturnValue(auth);

  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminRoute><div>Admin content</div></AdminRoute>} />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRoute', () => {
  afterEach(() => jest.clearAllMocks());

  it('redirects unauthenticated users to login', () => {
    renderWithAuth({ loading: false, isAuthenticated: false, user: null });
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('redirects authenticated non-admin users to dashboard', () => {
    renderWithAuth({
      loading: false,
      isAuthenticated: true,
      user: { app_metadata: {}, user_metadata: { role: 'admin' } },
    });
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });

  it('renders for an app_metadata admin', () => {
    renderWithAuth({
      loading: false,
      isAuthenticated: true,
      user: { app_metadata: { role: 'admin' } },
    });
    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });
});
