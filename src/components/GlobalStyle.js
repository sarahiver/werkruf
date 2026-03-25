import { createGlobalStyle } from 'styled-components';

/*
  CSS custom properties are injected by <ThemeInjector> in App.js.
  This file only handles base resets and font imports.
  All color values reference var(--color-*) so switching industry
  config automatically re-themes the entire UI.
*/
const GlobalStyle = createGlobalStyle`
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=Barlow:wght@400;500;600;700&family=Playfair+Display:wght@600;700&family=Lato:wght@400;700&family=Cormorant+Garamond:wght@500;600;700&family=Nunito+Sans:wght@400;600;700&display=swap');

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-size: 16px;
    scroll-behavior: smooth;
  }

  body {
    font-family: var(--font-body);
    background-color: var(--color-bg);
    color: var(--color-text);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  h1, h2, h3, h4 {
    font-family: var(--font-display);
    font-weight: var(--heading-weight);
    letter-spacing: var(--letter-spacing);
    line-height: 1.05;
  }

  a {
    text-decoration: none;
    color: inherit;
  }

  button {
    cursor: pointer;
    font-family: var(--font-body);
  }

  input, textarea, select {
    font-family: var(--font-body);
  }

  img { max-width: 100%; }
`;

export default GlobalStyle;
