import React from 'react';
import styled, { keyframes } from 'styled-components';

const fadeIn = keyframes`from{opacity:0}to{opacity:1}`;

const Wrap = styled.div`
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  min-height: 60vh; gap: 16px;
  animation: ${fadeIn} .4s ease both;
`;

const Title = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.6rem; text-transform: var(--text-transform);
  color: var(--color-primary);
`;

const Sub = styled.p`
  font-family: var(--font-body); font-size: .9rem;
  color: var(--color-text-muted);
`;

const Badge = styled.span`
  background: rgba(var(--color-accent-rgb), .1);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: .72rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 4px 12px; border-radius: var(--radius-button);
`;

export function DashboardPlaceholder({ title, description }) {
  return (
    <Wrap>
      <Badge>In Entwicklung</Badge>
      <Title>{title}</Title>
      <Sub>{description || 'Diese Seite wird in der nächsten Phase gebaut.'}</Sub>
    </Wrap>
  );
}

export default DashboardPlaceholder;
