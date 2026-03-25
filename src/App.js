import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import GlobalStyle from './components/GlobalStyle';
import Header from './components/Header';
import Footer from './components/Footer';

/* Pages */
import HomePage from './pages/HomePage';
import Pricing  from './pages/Pricing';

function App() {
  return (
    <BrowserRouter>
      <GlobalStyle />
      <Header />
      <Routes>
        <Route path="/"        element={<HomePage />} />
        <Route path="/pricing" element={<Pricing />} />
        {/* Placeholder routes — add later */}
        <Route path="/register" element={<div style={{padding:'120px 24px',textAlign:'center',fontFamily:'Barlow Condensed,sans-serif',fontSize:'2rem',color:'#002C51'}}>REGISTRIERUNG — COMING SOON</div>} />
        <Route path="/login"    element={<div style={{padding:'120px 24px',textAlign:'center',fontFamily:'Barlow Condensed,sans-serif',fontSize:'2rem',color:'#002C51'}}>LOGIN — COMING SOON</div>} />
      </Routes>
      <Footer />
    </BrowserRouter>
  );
}

export default App;
