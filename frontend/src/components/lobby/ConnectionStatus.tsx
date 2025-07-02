"use client";
import { Wifi, WifiOff } from 'lucide-react';

interface ConnectionStatusProps {
  status: 'connected' | 'disconnected' | 'connecting';
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ status }) => {
  return (
    <div className="absolute top-3 right-3 flex items-center z-10">
      {status === 'connected' ? (
        <div className="flex items-center text-green-400 bg-black/40 px-2 py-1 rounded-full">
          <Wifi size={16} className="mr-1 animate-pulse" />
          <span className="text-xs">Connected</span>
        </div>
      ) : status === 'connecting' ? (
        <div className="flex items-center text-yellow-400 bg-black/40 px-2 py-1 rounded-full">
          <Wifi size={16} className="mr-1 animate-ping" />
          <span className="text-xs">Connecting...</span>
        </div>
      ) : (
        <div className="flex items-center text-red-400 bg-black/40 px-2 py-1 rounded-full">
          <WifiOff size={16} className="mr-1" />
          <span className="text-xs">Disconnected</span>
        </div>
      )}
    </div>
  );
};
