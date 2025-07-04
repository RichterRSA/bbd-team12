"use client";
import React from 'react';
import { Settings, Users, Zap, LogOut, Play } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { GameState, Player } from './types';
import { TeamList } from './TeamList';
import { formatColorDisplay } from './utils';

interface LobbyViewProps {
  gameState: GameState;
  gameId: string | null;
  socket: Socket | null;
  isHost: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  handleSwitchTeam: () => void;
  handleStartColorConfirmation: () => void;
  handleStartGame: () => void;
  setShowConfirmation: (show: boolean) => void;
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  gameState,
  gameId,
  socket,
  isHost,
  connectionStatus,
  handleSwitchTeam,
  handleStartColorConfirmation,
  handleStartGame,
  setShowConfirmation,
}) => {
  // Count players by team
  const redTeam = gameState.players.filter(p => p.team === 'red');
  const blueTeam = gameState.players.filter(p => p.team === 'blue');
  const currentPlayer = gameState.players.find(p => p.id === socket?.id);

  return (
    <>
      <div className="text-center mb-6">
        <h1 className="text-4xl font-bold mb-1 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-green-400">
          {gameState.name}
        </h1>
        <div className={`inline-block px-4 py-1 rounded-full text-sm font-medium ${
          gameState.status === 'waiting' 
            ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-800' 
            : gameState.status === 'confirming-colors'
              ? 'bg-purple-900/50 text-purple-300 border border-purple-800'
              : 'bg-green-900/50 text-green-300 border border-green-800'
        }`}>
          {gameState.status === 'waiting' 
            ? '⏳ Waiting for players' 
            : gameState.status === 'confirming-colors' 
              ? '🎨 Confirming colors'
              : '🎮 Game in progress'
          }
        </div>
        
        <p className="text-gray-400 mt-2">
          Game ID: <span className="text-gray-300 font-mono">{gameId}</span>
        </p>
      </div>

      <div className="w-full max-w-3xl bg-gray-800/80 backdrop-blur-sm rounded-lg border border-gray-700 shadow-xl overflow-hidden">
        {/* Game status header */}
        <div className="bg-gray-900/80 px-6 py-4 border-b border-gray-700 flex justify-between items-center">
          <div className="flex items-center">
            <Settings className="text-gray-400 mr-2" size={18} />
            <span className="text-gray-300">Game Settings: </span>
            <span className="ml-1 text-cyan-400">{gameState.settings.gameMode}</span>
          </div>
          <div className="flex items-center">
            <Users className="text-gray-400 mr-2" size={18} />
            <span className="text-gray-300">{gameState.players.length}/{gameState.settings.maxPlayers}</span>
          </div>
        </div>
        
        {/* Teams display */}
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <TeamList 
              teamColor="red" 
              players={redTeam} 
              socketId={socket?.id}
              formatColorDisplay={formatColorDisplay}
            />
            <TeamList 
              teamColor="blue" 
              players={blueTeam} 
              socketId={socket?.id}
              formatColorDisplay={formatColorDisplay}
            />
          </div>

          {/* Action buttons */}
          <div className="mt-8 space-y-3">
            {gameState.status === 'waiting' && (
              <>
                <button
                  onClick={handleSwitchTeam}
                  disabled={connectionStatus !== 'connected'}
                  className={`w-full flex justify-center items-center px-4 py-3 transition-all duration-200 rounded-md ${
                    currentPlayer?.team === 'red'
                      ? 'bg-blue-700 hover:bg-blue-600 text-white'
                      : 'bg-red-700 hover:bg-red-600 text-white'
                  } disabled:opacity-50`}
                >
                  Switch to {currentPlayer?.team === 'red' ? 'Blue' : 'Red'} Team
                </button>
                
                {isHost && (
                  <>
                    <button
                      onClick={handleStartColorConfirmation}
                      disabled={gameState.players.length < 2 || connectionStatus !== 'connected'}
                      className="w-full flex justify-center items-center px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-md hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      <Zap className="mr-2" /> Start Color Confirmation
                      {gameState.players.length < 2 && 
                        <span className="ml-1 text-xs">(Need at least 2 players)</span>
                      }
                    </button>
                    
                    <button
                      onClick={handleStartGame}
                      disabled={gameState.players.length < 2 || connectionStatus !== 'connected'}
                      className="w-full flex justify-center items-center px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-md hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      <Play className="mr-2" /> Start Game (Skip Color Check)
                      {gameState.players.length < 2 && 
                        <span className="ml-1 text-xs">(Need at least 2 players)</span>
                      }
                    </button>
                  </>
                )}
              </>
            )}
            
            <button
              onClick={() => setShowConfirmation(true)}
              className="w-full flex justify-center items-center px-4 py-3 bg-gradient-to-r from-red-700 to-red-900 text-white rounded-md hover:from-red-600 hover:to-red-800 transition-all duration-200"
            >
              <LogOut className="mr-2" /> Leave Game
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
