'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  CalendarIcon, PlusIcon, LogInIcon, LogOutIcon, TicketIcon,
  MenuIcon, XIcon, ShieldIcon
} from '@/components/Icons';
import { useState } from 'react';

export default function Navbar() {
  const { user, logout, loading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isOrganizerOrAdmin = user?.is_admin || (user?.clubs && user.clubs.length > 0);

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link href="/" className="navbar-brand">
          <CalendarIcon size={28} color="var(--color-primary-400)" />
          <span>Ivent</span>
        </Link>

        <button
          className="navbar-mobile-toggle"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? <XIcon size={24} /> : <MenuIcon size={24} />}
        </button>

        <div className={`navbar-links ${mobileOpen ? 'navbar-links-open' : ''}`}>
          <Link href="/" className="navbar-link" onClick={() => setMobileOpen(false)}>
            <CalendarIcon size={18} />
            <span>Events</span>
          </Link>

          {!loading && user && (
            <>
              {isOrganizerOrAdmin && (
                <Link href="/events/create" className="navbar-link" onClick={() => setMobileOpen(false)}>
                  <PlusIcon size={18} />
                  <span>Create Event</span>
                </Link>
              )}
              <Link href="/my-registrations" className="navbar-link" onClick={() => setMobileOpen(false)}>
                <TicketIcon size={18} />
                <span>My Tickets</span>
              </Link>
              {user.is_admin && (
                <Link href="/admin" className="navbar-link" onClick={() => setMobileOpen(false)}>
                  <ShieldIcon size={18} color="var(--color-primary-400)" />
                  <span>Admin Panel</span>
                </Link>
              )}
            </>
          )}

          <div className="navbar-spacer" />

          {!loading && (
            <>
              {user ? (
                <div className="navbar-user">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="navbar-email">{user.email}</span>
                    {user.is_admin ? (
                      <span className="badge badge-primary" style={{ fontSize: '0.65rem' }}>Admin</span>
                    ) : user.clubs && user.clubs.length > 0 ? (
                      <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>
                        {user.clubs[0].name}
                      </span>
                    ) : null}
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { logout(); setMobileOpen(false); }}>
                    <LogOutIcon size={18} />
                    <span>Sign Out</span>
                  </button>
                </div>
              ) : (
                <Link href="/login" className="btn btn-primary btn-sm" onClick={() => setMobileOpen(false)}>
                  <LogInIcon size={18} />
                  <span>Sign In</span>
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
