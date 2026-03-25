import React from 'react';
import styled from 'styled-components';

const FooterWrap = styled.footer`
  background: #001A30;
  padding: 40px 24px;
  border-top: 4px solid #FF8C00;
`;

const Inner = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
`;

const Logo = styled.span`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: 1.3rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: white;
`;

const Links = styled.div`
  display: flex;
  gap: 28px;
`;

const FooterLink = styled.a`
  font-family: 'Barlow', sans-serif;
  font-size: 0.85rem;
  color: rgba(255,255,255,0.45);
  transition: color 0.2s;

  &:hover {
    color: #FF8C00;
  }
`;

const Copy = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.82rem;
  color: rgba(255,255,255,0.3);
`;

const Footer = () => (
  <FooterWrap>
    <Inner>
      <Logo>Werkruf</Logo>
      <Links>
        <FooterLink href="/impressum">Impressum</FooterLink>
        <FooterLink href="/datenschutz">Datenschutz</FooterLink>
        <FooterLink href="mailto:hallo@werkruf.de">Kontakt</FooterLink>
      </Links>
      <Copy>© {new Date().getFullYear()} Werkruf. Digitaler Rückenwind für echtes Handwerk.</Copy>
    </Inner>
  </FooterWrap>
);

export default Footer;
