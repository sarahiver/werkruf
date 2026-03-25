import { useEffect } from 'react';
import { useIndustry } from '../context/IndustryContext';

/*
  Writes all industry config values as CSS custom properties on :root.
  This makes them available to every styled-component and plain CSS rule.

  Result example for 'handwerk':
    :root {
      --color-primary:    #002C51;
      --color-accent:     #FF8C00;
      --color-bg:         #F2F2F2;
      --font-display:     'Barlow Condensed', sans-serif;
      --heading-weight:   900;
      ...
    }
*/
export default function ThemeInjector() {
  const { colors, typography, design, brand, key } = useIndustry();

  useEffect(() => {
    const root = document.documentElement;

    // Colors
    root.style.setProperty('--color-primary',   colors.primary);
    root.style.setProperty('--color-accent',     colors.accent);
    root.style.setProperty('--color-bg',         colors.bg);
    root.style.setProperty('--color-bg-dark',    colors.bgDark);
    root.style.setProperty('--color-text',       colors.text);
    root.style.setProperty('--color-text-muted', colors.textMuted);
    root.style.setProperty('--color-border',     colors.border);
    root.style.setProperty('--color-white',      colors.white);

    // Accent RGB for rgba() usage
    const hex = colors.accent.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    root.style.setProperty('--color-accent-rgb', `${r}, ${g}, ${b}`);

    // Primary RGB
    const hexP = colors.primary.replace('#', '');
    const rP = parseInt(hexP.slice(0, 2), 16);
    const gP = parseInt(hexP.slice(2, 4), 16);
    const bP = parseInt(hexP.slice(4, 6), 16);
    root.style.setProperty('--color-primary-rgb', `${rP}, ${gP}, ${bP}`);

    // Typography
    root.style.setProperty('--font-display',    typography.displayFont);
    root.style.setProperty('--font-body',        typography.bodyFont);
    root.style.setProperty('--heading-weight',   String(typography.headingWeight));
    root.style.setProperty('--letter-spacing',   typography.letterSpacing);
    root.style.setProperty('--text-transform',   typography.textTransform);

    // Design tokens
    root.style.setProperty('--radius-card',    design.cardBorderRadius);
    root.style.setProperty('--radius-button',  design.buttonBorderRadius);

    // Industry key (useful for CSS selectors)
    root.setAttribute('data-industry', key);
    document.title = brand.name + ' — ' + brand.tagline;

  }, [colors, typography, design, brand, key]);

  return null; // Render-less component
}
