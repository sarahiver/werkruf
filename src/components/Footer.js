import React from 'react';
import styled from 'styled-components';
import { useIndustry } from '../context/IndustryContext';
import { messId, oeffneConsentEinstellungen } from '../utils/analytics';

const FooterWrap = styled.footer`
  background: var(--color-bg-dark);
  padding: 36px 24px;
  border-top: 4px solid var(--color-accent);
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
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: 1.3rem;
  letter-spacing: 0.08em;
  text-transform: var(--text-transform);
  color: var(--color-white);
`;

const Links = styled.div`display: flex; gap: 12px 28px; flex-wrap: wrap;`;

const FooterLink = styled.a`
  font-family: var(--font-body);
  font-size: 0.83rem;
  color: rgba(255,255,255,0.4);
  transition: color 0.2s;
  &:hover { color: var(--color-accent); }
`;

/* Wie ein Link aussehend, aber ein Knopf: oeffnet die Einwilligung. */
const FooterKnopf = styled.button`
  font-family: var(--font-body); font-size: 0.83rem;
  color: rgba(255,255,255,0.4); background: none; border: 0; padding: 0; cursor: pointer;
  transition: color 0.2s;
  &:hover { color: var(--color-accent); }
  &:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
`;

const Copy = styled.p`
  font-family: var(--font-body);
  font-size: 0.8rem;
  color: rgba(255,255,255,0.28);
`;

const Footer = () => {
  const { brand, copy } = useIndustry();
  const { footer } = copy;

  return (
    <FooterWrap>
      <Inner>
        <Logo>{brand.logo}</Logo>
        <Links>
          {footer.links.map((link, i) => (
            <FooterLink key={i} href={link.href}>{link.label}</FooterLink>
          ))}
          {messId() && (
            <FooterKnopf type="button" onClick={oeffneConsentEinstellungen} data-testid="footer-cookie-einstellungen">
              Cookie-Einstellungen
            </FooterKnopf>
          )}
        </Links>
        <Copy>© {new Date().getFullYear()} {brand.name} — {footer.tagline}</Copy>
      </Inner>
    </FooterWrap>
  );
};

export default Footer;
