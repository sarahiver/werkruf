import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Link } from 'react-router-dom';
import { Home, Search, ArrowRight } from 'lucide-react';
import { useIndustry } from '../context/IndustryContext';

const fadeUp = keyframes`from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}`;
const float  = keyframes`0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}`;

const Page = styled.div`
  min-height: 100vh;
  background: var(--color-primary);
  display: flex; align-items: center; justify-content: center;
  padding: 60px 24px;
  position: relative; overflow: hidden;
`;

const Grid = styled.div`
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(var(--color-accent-rgb),.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--color-accent-rgb),.04) 1px, transparent 1px);
  background-size: 48px 48px;
`;

const AccentBar = styled.div`
  position: absolute; top: 0; right: 0;
  width: 5px; height: 100%;
  background: var(--color-accent);
`;

const Inner = styled.div`
  text-align: center; max-width: 560px;
  animation: ${fadeUp} .6s ease both;
  position: relative; z-index: 1;
`;

const BigNum = styled.div`
  font-family: var(--font-display); font-weight: 900;
  font-size: clamp(7rem, 20vw, 12rem);
  line-height: 1; color: var(--color-accent);
  opacity: .15; letter-spacing: -.05em;
  position: absolute; top: -60px; left: 50%;
  transform: translateX(-50%);
  pointer-events: none; user-select: none;
`;

const IconWrap = styled.div`
  width: 72px; height: 72px; border-radius: 50%;
  background: rgba(var(--color-accent-rgb), .12);
  border: 2px solid rgba(var(--color-accent-rgb), .25);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 24px;
  color: var(--color-accent);
  animation: ${float} 3s ease infinite;
`;

const Badge = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(var(--color-accent-rgb), .12);
  border: 1px solid rgba(var(--color-accent-rgb), .25);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: .72rem; letter-spacing: .12em; text-transform: uppercase;
  padding: 5px 12px; border-radius: var(--radius-button);
  margin-bottom: 20px;
`;

const Title = styled.h1`
  font-family: var(--font-display); font-weight: 900;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  text-transform: uppercase; color: white;
  line-height: 1.1; margin-bottom: 16px;
`;

const Sub = styled.p`
  font-family: var(--font-body); font-size: 1rem;
  color: rgba(255,255,255,.55); line-height: 1.7;
  margin-bottom: 40px;
`;

const Buttons = styled.div`
  display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
`;

const PrimaryBtn = styled(Link)`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 28px;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: 900;
  font-size: .9rem; letter-spacing: .08em; text-transform: uppercase;
  text-decoration: none; border-radius: var(--radius-button);
  box-shadow: 0 4px 20px rgba(var(--color-accent-rgb), .4);
  transition: filter .2s, transform .1s;
  &:hover { filter: brightness(.9); transform: translateY(-2px); }
`;

const SecondaryBtn = styled(Link)`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 28px;
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.15);
  color: rgba(255,255,255,.7);
  font-family: var(--font-body); font-weight: 600;
  font-size: .9rem; text-decoration: none;
  border-radius: var(--radius-button);
  transition: background .2s, color .2s;
  &:hover { background: rgba(255,255,255,.14); color: white; }
`;

export default function NotFound() {
  const { brand } = useIndustry();

  return (
    <Page>
      <Grid />
      <AccentBar />
      <Inner style={{ position: 'relative' }}>
        <BigNum>404</BigNum>
        <IconWrap><Search size={28} /></IconWrap>
        <Badge>Seite nicht gefunden</Badge>
        <Title>Diese Seite<br />existiert nicht.</Title>
        <Sub>
          Vielleicht wurde die Seite verschoben oder der Link ist falsch.
          Kein Problem — hier kommst du wieder rein:
        </Sub>
        <Buttons>
          <PrimaryBtn to="/">
            <Home size={16} /> Zur Startseite
          </PrimaryBtn>
          <SecondaryBtn to="/dashboard">
            Dashboard <ArrowRight size={15} />
          </SecondaryBtn>
        </Buttons>
      </Inner>
    </Page>
  );
}
