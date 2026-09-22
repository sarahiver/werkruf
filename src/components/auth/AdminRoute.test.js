import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import AdminRoute from './AdminRoute';
import { useAuthContext } from '../../context/AuthContext';

jest.mock('../../context/AuthContext', () => ({
  useAuthContext: jest.fn(),
}));

function renderRoute(auth) {
  useAuthContext.mockReturnValue(auth);

  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <div>Admin content</div>
            </AdminRoute>
          }
        />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRoute', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('redirects unauthenticated users to login', () => {
    renderRoute({ loading: false, isAuthenticated: false, isAdmin: false });
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  test('redirects authenticated non-admin users to dashboard', () => {
    renderRoute({ loading: false, isAuthenticated: true, isAdmin: false });
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });

  test('renders the admin page only for admins', () => {
    renderRoute({ loading: false, isAuthenticated: true, isAdmin: true });
    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });
});
