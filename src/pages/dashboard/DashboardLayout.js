import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import {
  LayoutDashboard, Star, Image, FileText,
  Settings, LogOut, Menu, X, Link2
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';

const slideIn = keyframes`from{transform:translateX(-100%)}to{transform:translateX(0)}`;

/* ─────────────────────────────────────────────
   LAYOUT SHELL
───────────────────────────────────────────── */
const Shell = styled.div`
  display: flex;
  min-height: 100vh;
  background: var(--color-bg);
`;

/* ── SIDEBAR ── */
const Sidebar = styled.aside`
  width: 260px;
  flex-shrink: 0;
  background: var(--color-primary);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0; left: 0; bottom: 0;
  z-index: 50;
  transition: transform .25s ease;

  @media(max-width:900px) {
    transform: ${({ $open }) => $open ? 'translateX(0)' : 'translateX(-100%)'};
  }
`;

const SidebarTop = styled.div`
  padding: 24px 20px 16px;
  border-bottom: 1px solid rgba(255,255,255,.08);
`;

const BrandMark = styled.div`
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: 1.3rem;
  letter-spacing: .08em;
  text-transform: var(--text-transform);
  color: var(--color-white);
  margin-bottom: 4px;
`;

const UserInfo = styled.div`
  display: flex; align-items: center; gap: 10px; margin-top: 12px;
`;

const Avatar = styled.div`
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--color-accent);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 800;
  font-size: .9rem; color: white; flex-shrink: 0;
`;

const UserDetails = styled.div``;

const UserName = styled.p`
  font-family: var(--font-body); font-weight: 600;
  font-size: .85rem; color: white;
`;

const UserEmail = styled.p`
  font-family: var(--font-body); font-size: .72rem;
  color: rgba(255,255,255,.45);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 160px;
`;

const Nav = styled.nav`
  flex: 1; padding: 16px 12px; display: flex; flex-direction: column; gap: 2px;
`;

const NavItem = styled(NavLink)`
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  font-family: var(--font-body); font-weight: 600;
  font-size: .88rem; color: rgba(255,255,255,.6);
  text-decoration: none; border-radius: var(--radius-button);
  transition: background .15s, color .15s;

  &:hover { background: rgba(255,255,255,.07); color: white; }
  &.active { background: rgba(var(--color-accent-rgb),.15); color: var(--color-accent); }
  svg { flex-shrink: 0; }
`;

const SidebarBottom = styled.div`
  padding: 12px;
  border-top: 1px solid rgba(255,255,255,.08);
`;

const SignOutBtn = styled.button`
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 12px; background: none; border: none; cursor: pointer;
  font-family: var(--font-body); font-weight: 600;
  font-size: .88rem; color: rgba(255,255,255,.45);
  border-radius: var(--radius-button);
  transition: background .15s, color .15s;
  &:hover { background: rgba(255,255,255,.07); color: #ff8080; }
`;

/* ── MAIN AREA ── */
const Main = styled.main`
  flex: 1;
  margin-left: 260px;
  min-height: 100vh;
  display: flex; flex-direction: column;

  @media(max-width:900px) { margin-left: 0; }
`;

const TopBar = styled.div`
  height: 60px;
  background: var(--color-white);
  border-bottom: 1px solid var(--color-border);
  display: flex; align-items: center;
  padding: 0 24px; gap: 16px;
  position: sticky; top: 0; z-index: 40;
`;

const MobileMenuBtn = styled.button`
  display: none; background: none; border: none; cursor: pointer;
  color: var(--color-primary); padding: 4px;
  @media(max-width:900px) { display: flex; align-items: center; }
`;

const TopBarTitle = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; text-transform: var(--text-transform);
  color: var(--color-primary); letter-spacing: .04em;
`;

const Overlay = styled.div`
  display: none;
  @media(max-width:900px) {
    display: ${({ $open }) => $open ? 'block' : 'none'};
    position: fixed; inset: 0;
    background: rgba(0,0,0,.5); z-index: 49;
  }
`;

const Content = styled.div`
  flex: 1; padding: 32px 28px;
  @media(max-width:560px) { padding: 20px 16px; }
`;

/* ─────────────────────────────────────────────
   NAV ITEMS
───────────────────────────────────────────── */
const NAV_ITEMS = [
  { to: '/dashboard',            icon: <LayoutDashboard size={17} />, label: 'Übersicht'    },
  { to: '/dashboard/bewertungen',icon: <Star size={17} />,            label: 'Bewertungen'  },
  { to: '/dashboard/fotos',      icon: <Image size={17} />,           label: 'Fotos'        },
  { to: '/dashboard/reporting',  icon: <FileText size={17} />,        label: 'Reporting'    },
  { to: '/dashboard/einstellungen',icon: <Settings size={17} />,      label: 'Einstellungen'},
];

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardLayout() {
  const { user, profile, signOut } = useAuthContext();
  const { brand } = useIndustry();
  const navigate  = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const initials = (user?.email || 'U')[0].toUpperCase();
  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Nutzer';

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <Shell>
      <Overlay $open={sidebarOpen} onClick={() => setSidebarOpen(false)} />

      <Sidebar $open={sidebarOpen}>
        <SidebarTop>
          <BrandMark>{brand.logo}</BrandMark>
          <UserInfo>
            <Avatar>{initials}</Avatar>
            <UserDetails>
              <UserName>{displayName}</UserName>
              <UserEmail>{user?.email}</UserEmail>
            </UserDetails>
          </UserInfo>
        </SidebarTop>

        <Nav>
          {NAV_ITEMS.map(item => (
            <NavItem
              key={item.to}
              to={item.to}
              end={item.to === '/dashboard'}
              onClick={() => setSidebarOpen(false)}
            >
              {item.icon}
              {item.label}
            </NavItem>
          ))}
        </Nav>

        <SidebarBottom>
          <SignOutBtn onClick={handleSignOut}>
            <LogOut size={17} />
            Abmelden
          </SignOutBtn>
        </SidebarBottom>
      </Sidebar>

      <Main>
        <TopBar>
          <MobileMenuBtn onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </MobileMenuBtn>
          <TopBarTitle>{brand.name} Dashboard</TopBarTitle>
        </TopBar>
        <Content>
          <Outlet />
        </Content>
      </Main>
    </Shell>
  );
}
