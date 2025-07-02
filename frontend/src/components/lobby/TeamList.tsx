"use client";
import { Crown, Shield } from 'lucide-react';
import { Socket } from 'socket.io-client';

interface Player {
  id: string;
  name: string;
  isHost: boolean;
  team: 'red' | 'blue';
  isConfirmed?: boolean;
  shirtColor?: string;
}

interface TeamListProps {
  teamColor: 'red' | 'blue';
  players: Player[];
  socketId: string | undefined;
  formatColorDisplay: (color: string | undefined) => string;
}

export const TeamList: React.FC<TeamListProps> = ({ teamColor, players, socketId, formatColorDisplay }) => {
  const isRedTeam = teamColor === 'red';
  const bgGradient = isRedTeam ? 'from-red-950/60' : 'from-blue-950/60';
  const borderColor = isRedTeam ? 'border-red-900/70' : 'border-blue-900/70';
  const titleColor = isRedTeam ? 'text-red-400' : 'text-blue-400';
  const bgOverlay = isRedTeam ? 'bg-red-900/20' : 'bg-blue-900/20';
  const bgHighlight = isRedTeam ? 'bg-red-900/30' : 'bg-blue-900/30';
  const borderHighlight = isRedTeam ? 'border-red-800/50' : 'border-blue-800/50';
  const avatarBg = isRedTeam ? 'bg-red-800' : 'bg-blue-800';

  return (
    <div className="relative">
      <div className={`absolute inset-0 ${bgOverlay} rounded-lg -z-10`}></div>
      <div className={`p-4 border ${borderColor} rounded-lg bg-gradient-to-br ${bgGradient} to-black/40`}>
        <h3 className={`text-xl font-bold ${titleColor} flex items-center mb-3 pb-2 border-b ${isRedTeam ? 'border-red-900/30' : 'border-blue-900/30'}`}>
          <Shield className="mr-2" size={20} />
          {isRedTeam ? 'Red' : 'Blue'} Team ({players.length})
        </h3>
        <ul className="space-y-2 min-h-[120px]">
          {players.length === 0 ? (
            <li className="text-gray-500 text-center italic py-2">No players yet</li>
          ) : players.map(player => (
            <li 
              key={player.id} 
              className={`flex items-center justify-between p-2 rounded-lg ${
                player.id === socketId ? `${bgHighlight} border ${borderHighlight}` : ''
              }`}
            >
              <div className="flex items-center">
                <div className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center mr-3 relative`}>
                  {player.name.charAt(0).toUpperCase()}
                  {player.isConfirmed && player.shirtColor && (
                    <div 
                      className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white`}
                      style={{ backgroundColor: player.shirtColor }}
                      title={`Confirmed shirt color: ${formatColorDisplay(player.shirtColor)}`}
                    />
                  )}
                </div>
                <div>
                  <span>{player.name}</span>
                  {player.isConfirmed && player.shirtColor && (
                    <div className="text-xs text-gray-400">
                      Shirt: {formatColorDisplay(player.shirtColor)}
                    </div>
                  )}
                </div>
                {player.isHost && 
                  <div className="ml-2 flex items-center text-yellow-500">
                    <Crown size={14} className="mr-1" />
                    <span className="text-xs">Host</span>
                  </div>
                }
              </div>
              {player.id === socketId && 
                <span className="text-xs bg-white/10 px-2 py-0.5 rounded">You</span>
              }
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
