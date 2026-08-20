'use client';

import { AuthProvider } from '@/context/AuthContext';
import { NetworkProvider } from '@/context/NetworkContext';
import Navbar from '@/components/Navbar';
import NetworkStatusBar from '@/components/NetworkStatusBar';

export default function ClientLayout({ children }) {
  return (
    <NetworkProvider>
      <AuthProvider>
        <NetworkStatusBar />
        <Navbar />
        <main>{children}</main>
      </AuthProvider>
    </NetworkProvider>
  );
}
