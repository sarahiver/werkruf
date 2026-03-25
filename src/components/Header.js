import React, { useState, useEffect } from 'react';
import styled, { css } from 'styled-components';
import { Menu, X } from 'lucide-react';

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
`;

const LogoSvg = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 3C19.2 3 18.4 3.1 17.6 3.2L16.8 6.4C15.7 6.7 14.7 7.1 13.8 7.7L10.7 6L8 8.7L9.6 11.9C9 12.8 8.6 13.8 8.3 14.9L5.1 15.7C5 16.4 4.9 17.2 4.9 20C4.9 20.8 5 21.6 5.1 22.4L8.3 23.2C8.6 24.3 9 25.3 9.6 26.2L8 29.4L10.7 32.1L13.8 30.4C14.7 31 15.7 31.4 16.8 31.7L17.6 34.9C18.4 35 19.2 35.1 20 35.1C20.8 35.1 21.6 35 22.4 34.8L23.2 31.6C24.3 31.3 25.3 30.9 26.2 30.3L29.4 32L32.1 29.3L30.4 26.1C31 25.2 31.4 24.2 31.7 23.1L34.9 22.3C35 21.6 35.1 20.8 35.1 20C35.1 19.2 35 18.4 34.8 17.6L31.6 16.8C31.3 15.7 30.9 14.7 30.3 13.8L32 10.6L29.3 7.9L26.1 9.6C25.2 9 24.2 8.6 23.1 8.3L22.3 5.1C21.6 5 20.8 4.9 20 3Z" fill="white"/>
    <circle cx="20" cy="20" r="9" fill="#002C51"/>
    <text x="20" y="25" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="900" fontSize="12" fill="white">W</text>
    <path d="M24.5 9.5 Q27 7.5 29.5 9.5" stroke="#FF8C00" strokeWidth="2" strokeLinecap="round" fill="none"/>
    <path d="M26 7 Q30 4.5 34 7" stroke="#FF8C00" strokeWidth="2" strokeLinecap="round" fill="none"/>
  </svg>
);

const LogoText = styled.span`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: 1.6rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: white;
`;

const NavLinks = styled.nav`
  display: flex;
  align-items: center;
  gap: 36px;
  @media (max-width: 768px) { display: none; }
`;

const NavLink = styled.a`
  font-family: 'Barlow', sans-serif;
  font-weight: 600;
  font-size: 0.85rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.75);
  transition: color 0.2s;
  &:hover { color: #FF8C00; }
`;

const LoginBtn = styled.a`
  padding: 10px 24px;
  background: #FF8C00;
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transition: background 0.2s;
  &:hover { background: #E07A00; }
  @media (max-width: 768px) { display: none; }
`;

const MobileMenuBtn = styled.button`
  display: none;
  background: none;
  border: none;
  color: white;
  padding: 4px;
  @media (max-width: 768px) { display: flex; align-items: center; }
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
  border-top: 3px solid #FF8C00;
  ${({ $open }) => $open && css`display: flex;`}
  @media (min-width: 769px) { display: none !important; }
`;

const MobileNavLink = styled.a`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1.4rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: white;
  &:hover { color: #FF8C00; }
`;

const MobileLoginBtn = styled.a`
  padding: 14px 24px;
  background: #FF8C00;
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: center;
`;

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
            <LogoSvg />
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
