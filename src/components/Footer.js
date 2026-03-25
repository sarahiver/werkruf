import React from 'react';
import styled from 'styled-components';
import { useIndustry } from '../context/IndustryContext';

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

const Links = styled.div`display: flex; gap: 28px;`;

const FooterLink = styled.a`
  font-family: var(--font-body);
  font-size: 0.83rem;
  color: rgba(255,255,255,0.4);
  transition: color 0.2s;
  &:hover { color: var(--color-accent); }
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
        </Links>
        <Copy>© {new Date().getFullYear()} {brand.name} — {footer.tagline}</Copy>
      </Inner>
    </FooterWrap>
  );
};

export default Footer;
