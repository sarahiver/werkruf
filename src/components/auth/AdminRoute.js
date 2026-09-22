import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { useAuthContext } from '../../context/AuthContext';

const spin = keyframes`to { transform: rotate(360deg); }`;

const LoadWrap = styled.div`
  min-height: 100vh;
  background: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Spinner = styled.div`
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255,255,255,.2);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: ${spin} .7s linear infinite;
`;

const AdminRoute = ({ children }) => {
  const { isAuthenticated, isAdmin, loading } = useAuthContext();
  const location = useLocation();

  if (loading) {
    return (
      <LoadWrap>
        <Spinner />
      </LoadWrap>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default AdminRoute;
