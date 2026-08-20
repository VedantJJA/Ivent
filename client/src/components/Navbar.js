'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { CalendarIcon, PlusIcon, LogInIcon, LogOutIcon, TicketIcon, MenuIcon, XIcon } from '@/components/Icons';
import { useState } from 'react';

export default function Navbar() {
  const { user, logout, loading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

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
              <Link href="/events/create" className="navbar-link" onClick={() => setMobileOpen(false)}>
                <PlusIcon size={18} />
                <span>Create Event</span>
              </Link>
              <Link href="/my-registrations" className="navbar-link" onClick={() => setMobileOpen(false)}>
                <TicketIcon size={18} />
                <span>My Tickets</span>
              </Link>
            </>
          )}

          <div className="navbar-spacer" />

          {!loading && (
            <>
              {user ? (
                <div className="navbar-user">
                  <span className="navbar-email">{user.email}</span>
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
