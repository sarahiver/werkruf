import React, { useState, useEffect } from 'react';
import styled, { css } from 'styled-components';
import { Menu, X } from 'lucide-react';

/* ── Logo SVG (inline, keine externe Datei nötig) ── */
const LogoMark = () => (
  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Gear outline */}
    <path d="M22 4C21.1 4 20.2 4.1 19.4 4.2L18.5 7.8C17.3 8.1 16.2 8.6 15.2 9.2L11.8 7.4C10.6 8.2 9.6 9.2 8.7 10.3L10.4 13.8C9.8 14.8 9.3 15.9 9 17.1L5.4 18C5.1 19 5 20 5 21V23C5 23.9 5.1 24.8 5.2 25.7L8.8 26.6C9.1 27.8 9.6 28.9 10.2 29.9L8.4 33.3C9.2 34.5 10.2 35.5 11.3 36.4L14.8 34.7C15.8 35.3 16.9 35.8 18.1 36.1L19 39.7C20 40 21 40.1 22 40.1C23 40.1 23.9 40 24.7 39.8L25.6 36.2C26.8 35.9 27.9 35.4 28.9 34.8L32.3 36.6C33.5 35.8 34.5 34.8 35.4 33.7L33.7 30.2C34.3 29.2 34.8 28.1 35.1 26.9L38.7 26C39 25 39.1 24 39.1 23V21C39.1 20.1 39 19.2 38.8 18.4L35.2 17.5C34.9 16.3 34.4 15.2 33.8 14.2L35.6 10.8C34.8 9.6 33.8 8.6 32.7 7.7L29.2 9.4C28.2 8.8 27.1 8.3 25.9 8L25 4.4C24 4.1 23 4 22 4Z" fill="#002C51"/>
    {/* Inner circle white */}
    <circle cx="22" cy="22" r="10" fill="white"/>
    {/* W letter */}
    <text x="22" y="27" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="900" fontSize="13" fill="#002C51">W</text>
    {/* WiFi/signal arcs top-right */}
    <path d="M27 10 Q30 7 33 10" stroke="#FF8C00" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
    <path d="M28.5 7.5 Q33 4 37.5 7.5" stroke="#FF8C00" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
  </svg>
);

/* ── Styled Components ── */
const Nav = styled.header`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: ${({ $scrolled }) => $scrolled ? '#002C51' : 'transparent'};
  transition: background 0.3s ease, box-shadow 0.3s ease;
  box-shadow: ${({ $scrolled }) => $scrolled ? '0 2px 20px rgba(0,44,81,0.3)' : 'none'};
`;

const NavInner = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const LogoWrap = styled.a`
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
`;

const LogoText = styled.span`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: 1.6rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: white;
`;

const NavLinks = styled.nav`
  display: flex;
  align-items: center;
  gap: 36px;

  @media (max-width: 768px) {
    display: none;
  }
`;

const NavLink = styled.a`
  font-family: 'Barlow', sans-serif;
  font-weight: 600;
  font-size: 0.9rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.8);
  transition: color 0.2s;

  &:hover {
    color: #FF8C00;
  }
`;

const LoginBtn = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  background: #FF8C00;
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: none;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;

  &:hover {
    background: #E07A00;
    transform: translateY(-1px);
  }

  @media (max-width: 768px) {
    display: none;
  }
`;

const MobileMenuBtn = styled.button`
  display: none;
  background: none;
  border: none;
  color: white;
  padding: 4px;

  @media (max-width: 768px) {
    display: flex;
    align-items: center;
  }
`;

const MobileMenu = styled.div`
  display: none;
  position: fixed;
  top: 72px;
  left: 0;
  right: 0;
  background: #002C51;
  padding: 24px;
  flex-direction: column;
  gap: 20px;
  z-index: 99;

  ${({ $open }) => $open && css`
    display: flex;
  `}

  @media (min-width: 769px) {
    display: none !important;
  }
`;

const MobileNavLink = styled.a`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1.4rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: white;

  &:hover {
    color: #FF8C00;
  }
`;

const MobileLoginBtn = styled.a`
  padding: 14px 24px;
  background: #FF8C00;
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1.2rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: center;
`;

/* ── Component ── */
const Header = () => {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <Nav $scrolled={scrolled}>
        <NavInner>
          <LogoWrap href="/">
            <LogoMark />
            <LogoText>Werkruf</LogoText>
          </LogoWrap>

          <NavLinks>
            <NavLink href="#features">Was du kriegst</NavLink>
            <NavLink href="#how">Wie's läuft</NavLink>
            <NavLink href="#form">Sichtbarkeits-Check</NavLink>
          </NavLinks>

          <LoginBtn href="/login">Einloggen</LoginBtn>

          <MobileMenuBtn onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={28} /> : <Menu size={28} />}
          </MobileMenuBtn>
        </NavInner>
      </Nav>

      <MobileMenu $open={menuOpen}>
        <MobileNavLink href="#features" onClick={() => setMenuOpen(false)}>Was du kriegst</MobileNavLink>
        <MobileNavLink href="#how" onClick={() => setMenuOpen(false)}>Wie's läuft</MobileNavLink>
        <MobileNavLink href="#form" onClick={() => setMenuOpen(false)}>Sichtbarkeits-Check</MobileNavLink>
        <MobileLoginBtn href="/login">Einloggen</MobileLoginBtn>
      </MobileMenu>
    </>
  );
};

export default Header;
