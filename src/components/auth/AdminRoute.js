import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../../context/AuthContext';
import { hasAdminRole } from '../../utils/authorization';
import ProtectedRoute from './ProtectedRoute';

const AdminOnly = ({ children }) => {
  const { user } = useAuthContext();

  if (!hasAdminRole(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

const AdminRoute = ({ children }) => {
  const location = useLocation();

  return (
    <ProtectedRoute>
      <AdminOnly key={location.key}>{children}</AdminOnly>
    </ProtectedRoute>
  );
};

export default AdminRoute;
