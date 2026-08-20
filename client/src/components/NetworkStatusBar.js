'use client';

import { useNetwork } from '@/context/NetworkContext';
import { WifiOffIcon, CheckCircleIcon } from '@/components/Icons';
import { useState, useEffect } from 'react';

export default function NetworkStatusBar() {
  const { isOnline, wasOffline } = useNetwork();
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (isOnline && wasOffline) {
      setShowReconnected(true);
      const timer = setTimeout(() => {
        setShowReconnected(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline]);

  if (!isOnline) {
    return (
      <div
        style={{
          background: 'linear-gradient(90deg, #b45309, #d97706)',
          color: '#ffffff',
          padding: '6px 16px',
          textAlign: 'center',
          fontSize: '0.8rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          zIndex: 9999,
          position: 'sticky',
          top: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        <WifiOffIcon size={16} color="#ffffff" />
        <span>Offline Mode Active &bull; Changes are saved locally</span>
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div
        style={{
          background: 'linear-gradient(90deg, #15803d, #16a34a)',
          color: '#ffffff',
          padding: '6px 16px',
          textAlign: 'center',
          fontSize: '0.8rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          zIndex: 9999,
          position: 'sticky',
          top: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          animation: 'fadeIn 0.3s ease-in-out',
        }}
      >
        <CheckCircleIcon size={16} color="#ffffff" />
        <span>Back Online &bull; Connected to server</span>
      </div>
    );
  }

  return null;
}
