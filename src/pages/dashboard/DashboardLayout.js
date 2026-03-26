import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import styled, { css } from 'styled-components';
import {
  LayoutDashboard, Star, Image,
  FileText, Settings, LogOut, Menu, X, Link2, Users
} from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { useIndustry } from '../../context/IndustryContext';

/* ─────────────────────────────────────────────
   SHELL
───────────────────────────────────────────── */
const Shell = styled.div`
  display: flex;
  min-height: 100vh;
  background: var(--color-bg);
`;

/* ─────────────────────────────────────────────
   SIDEBAR
───────────────────────────────────────────── */
const Sidebar = styled.aside`
  width: 240px;
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
  padding: 22px 18px 14px;
  border-bottom: 1px solid rgba(255,255,255,.08);
`;

const Brand = styled.div`
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  font-size: 1.25rem;
  letter-spacing: .08em;
  text-transform: var(--text-transform);
  color: var(--color-white);
  margin-bottom: 14px;
`;

const UserRow = styled.div`
  display: flex; align-items: center; gap: 10px;
`;

const Avatar = styled.div`
  width: 34px; height: 34px; border-radius: 50%;
  background: var(--color-accent);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 800;
  font-size: .85rem; color: white; flex-shrink: 0;
  text-transform: uppercase;
`;

const UserInfo = styled.div`min-width: 0;`;

const UserName = styled.p`
  font-family: var(--font-body); font-weight: 600;
  font-size: .83rem; color: white;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;

const UserEmail = styled.p`
  font-family: var(--font-body); font-size: .7rem;
  color: rgba(255,255,255,.4);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;

/* ─────────────────────────────────────────────
   NAV
───────────────────────────────────────────── */
const Nav = styled.nav`
  flex: 1;
  padding: 14px 10px;
  display: flex; flex-direction: column; gap: 2px;
  overflow-y: auto;
`;

const NavItem = styled(NavLink)`
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px;
  font-family: var(--font-body); font-weight: 600;
  font-size: .86rem; color: rgba(255,255,255,.55);
  text-decoration: none;
  border-radius: var(--radius-button);
  transition: background .15s, color .15s;

  svg {
    flex-shrink: 0;
    color: rgba(255,255,255,.35);
    transition: color .15s;
  }

  &:hover {
    background: rgba(255,255,255,.07);
    color: rgba(255,255,255,.85);
    svg { color: var(--color-accent); }
  }

  &.active {
    background: rgba(var(--color-accent-rgb), .12);
    color: var(--color-accent);
    svg { color: var(--color-accent); }
  }
`;

const NavDivider = styled.div`
  height: 1px;
  background: rgba(255,255,255,.07);
  margin: 6px 0;
`;

/* ─────────────────────────────────────────────
   SIDEBAR BOTTOM
───────────────────────────────────────────── */
const SidebarBottom = styled.div`
  padding: 10px;
  border-top: 1px solid rgba(255,255,255,.08);
`;

const SignOutBtn = styled.button`
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 9px 10px;
  background: none; border: none; cursor: pointer;
  font-family: var(--font-body); font-weight: 600;
  font-size: .86rem; color: rgba(255,255,255,.4);
  border-radius: var(--radius-button);
  transition: background .15s, color .15s;
  text-align: left;

  svg { flex-shrink: 0; color: rgba(255,255,255,.25); transition: color .15s; }

  &:hover {
    background: rgba(255,0,0,.08);
    color: #ff8080;
    svg { color: #ff8080; }
  }
`;

/* ─────────────────────────────────────────────
   MAIN
───────────────────────────────────────────── */
const Main = styled.main`
  flex: 1;
  margin-left: 240px;
  min-height: 100vh;
  display: flex; flex-direction: column;
  @media(max-width:900px) { margin-left: 0; }
`;

const TopBar = styled.div`
  height: 56px;
  background: var(--color-white);
  border-bottom: 1px solid var(--color-border);
  display: flex; align-items: center;
  padding: 0 24px; gap: 14px;
  position: sticky; top: 0; z-index: 40;
`;

const MobileBtn = styled.button`
  display: none; background: none; border: none;
  cursor: pointer; color: var(--color-primary); padding: 4px;
  @media(max-width:900px) { display: flex; align-items: center; }
`;

const TopBarTitle = styled.p`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .95rem; text-transform: var(--text-transform);
  color: var(--color-primary); letter-spacing: .04em;
`;

const Overlay = styled.div`
  @media(max-width:900px) {
    display: ${({ $open }) => $open ? 'block' : 'none'};
    position: fixed; inset: 0;
    background: rgba(0,0,0,.5); z-index: 49;
  }
`;

const Content = styled.div`
  flex: 1; padding: 28px 24px;
  @media(max-width:560px) { padding: 18px 14px; }
`;

/* ─────────────────────────────────────────────
   NAV CONFIG
───────────────────────────────────────────── */
const SimBadge = styled.span`
  font-family: var(--font-body); font-size: .6rem; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase;
  background: rgba(var(--color-accent-rgb), .15);
  color: var(--color-accent);
  border: 1px solid rgba(var(--color-accent-rgb), .3);
  padding: 1px 5px; border-radius: 3px;
  margin-left: auto; flex-shrink: 0;
`;

const NAV_ITEMS = [
  { to: '/dashboard',                  icon: LayoutDashboard, label: 'Übersicht',         end: true },
  { to: '/dashboard/bewertungen',      icon: Star,            label: 'Bewertungen',       badge: 'Simulation' },
  { to: '/dashboard/fotos',            icon: Image,           label: 'Fotos & Galerie'    },
  { to: '/dashboard/kunden-gewinnung', icon: Users,           label: 'Kunden-Gewinnung'  },
  { to: '/dashboard/reporting',        icon: FileText,        label: 'Reporting'          },
  { to: '/dashboard/einstellungen',    icon: Settings,        label: 'Einstellungen'      },
];

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardLayout() {
  const { user, profile, signOut } = useAuthContext();
  const { brand } = useIndustry();
  const navigate   = useNavigate();
  const [open, setOpen] = useState(false);

  const initials    = (profile?.full_name || user?.email || 'U')[0].toUpperCase();
  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Nutzer';

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <Shell>
      <Overlay $open={open} onClick={() => setOpen(false)} />

      <Sidebar $open={open}>
        <SidebarTop>
          <Brand>{brand.logo}</Brand>
          <UserRow>
            <Avatar>{initials}</Avatar>
            <UserInfo>
              <UserName>{displayName}</UserName>
              <UserEmail>{user?.email}</UserEmail>
            </UserInfo>
          </UserRow>
        </SidebarTop>

        <Nav>
          {NAV_ITEMS.map(({ to, icon: Icon, label, end, badge }) => (
            <NavItem
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
            >
              <Icon size={16} />
              {label}
              {badge && <SimBadge>{badge}</SimBadge>}
            </NavItem>
          ))}
          <NavDivider />
        </Nav>

        <SidebarBottom>
          <SignOutBtn onClick={handleSignOut}>
            <LogOut size={16} />
            Abmelden
          </SignOutBtn>
        </SidebarBottom>
      </Sidebar>

      <Main>
        <TopBar>
          <MobileBtn onClick={() => setOpen(!open)}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </MobileBtn>
          <TopBarTitle>{brand.name} Dashboard</TopBarTitle>
        </TopBar>
        <Content>
          <Outlet />
        </Content>
      </Main>
    </Shell>
  );
}
