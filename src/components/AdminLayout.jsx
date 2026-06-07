import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { clearAuthSession, AUTH_STORAGE } from '../utils/auth';
import './AdminLayout.css';

export default function AdminLayout({ onLogout }) {
  const navigate = useNavigate();
  const userEmail = useMemo(() => localStorage.getItem(AUTH_STORAGE.userEmail) || '', []);

  const handleLogout = () => {
    clearAuthSession();
    onLogout?.();
    navigate('/login', { replace: true });
  };

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div className="admin-brand-title">PrintEasy</div>
          <div className="admin-brand-subtitle">Order Admin</div>
        </div>

        <nav className="admin-nav">
          <NavLink to="/orders" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <span className="admin-nav-icon" aria-hidden="true">📦</span>
            <span className="admin-nav-text">Orders</span>
          </NavLink>
          <NavLink to="/products" className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}>
            <span className="admin-nav-icon" aria-hidden="true">👕</span>
            <span className="admin-nav-text">Products</span>
          </NavLink>
        </nav>
      </aside>

      <main className="admin-main">
        <div className="admin-topbar">
          <div className="admin-topbar-title">Dashboard</div>
          <div className="admin-topbar-actions">
            {userEmail ? <div className="admin-topbar-email">{userEmail}</div> : null}
            <button className="admin-topbar-logout" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
        <div className="admin-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

