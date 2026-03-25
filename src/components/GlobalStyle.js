import { createGlobalStyle } from 'styled-components';

const GlobalStyle = createGlobalStyle`
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=Barlow:wght@400;500;600;700&display=swap');

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :root {
    --navy: #002C51;
    --orange: #FF8C00;
    --bg: #F2F2F2;
    --white: #FFFFFF;
    --text-dark: #1A1A1A;
    --text-muted: #5A6A7A;
    --border: #D0D8E0;
  }

  html {
    font-size: 16px;
    scroll-behavior: smooth;
  }

  body {
    font-family: 'Barlow', sans-serif;
    background-color: var(--bg);
    color: var(--text-dark);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  h1, h2, h3, h4 {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 1.05;
  }

  a {
    text-decoration: none;
    color: inherit;
  }

  button {
    cursor: pointer;
    font-family: 'Barlow', sans-serif;
  }

  input, textarea, select {
    font-family: 'Barlow', sans-serif;
  }

  img {
    max-width: 100%;
  }
`;

export default GlobalStyle;
