"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import io, { Socket } from 'socket.io-client';
import { 
  Users, Play, Eye, Clock, Trophy, Activity, AlertCircle,
  RefreshCw, ExternalLink, Search, Filter, Gamepad2
} from 'lucide-react';

// Types for spectator data
interface SpectatorPlayer {
  id: string;
  name: string;
  team: 'red' | 'blue';
  health: number;
  isAlive: boolean;
  tags: number;
  deaths: number;
  shirtColor?: string;
}

interface SpectatorGame {
  id: string;
  name: string;
  status: 'waiting' | 'in-progress' | 'finished';
  players: SpectatorPlayer[];
  settings: {
    maxPlayers: number;
    gameMode: string;
    duration?: number;
  };
  startTime?: number;
  score: {
    red: number;
    blue: number;
  };
}

export default function SpectatorLobby() {
  const router = useRouter();
  
  // Socket and game state
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [availableGames, setAvailableGames] = useState<SpectatorGame[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'waiting' | 'in-progress' | 'finished'>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  // Refs
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Connect to Socket.IO server
  useEffect(() => {
    if (typeof window === 'undefined') return;

    setConnectionStatus('connecting');
    setLoading(true);
    
    let socketUrl: string;
    if (process.env.NODE_ENV === 'development') {
      socketUrl = 'http://localhost:3001';
    } else {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      socketUrl = `${protocol}//${window.location.host}`;
    }
    
    console.log(`Spectator lobby connecting to: ${socketUrl}`);
    
    const newSocket: Socket = io(socketUrl, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      path: '/socket.io/',
    });
    
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Spectator lobby connected to server');
      setConnectionStatus('connected');
      
      // Join as spectator and request game list
      newSocket.emit('spectatorJoin');
      newSocket.emit('requestGameList');
    });

    newSocket.on('disconnect', () => {
      console.log('Spectator lobby disconnected from server');
      setConnectionStatus('disconnected');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Spectator lobby connection error:', error);
      setConnectionStatus('disconnected');
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;

    socket.on('gameList', (games: SpectatorGame[]) => {
      console.log('Received game list:', games);
      setAvailableGames(games || []);
      setLoading(false);
    });

    socket.on('gameListUpdate', (games: SpectatorGame[]) => {
      console.log('Game list updated:', games);
      setAvailableGames(games || []);
    });

    socket.on('gameUpdate', (gameData: SpectatorGame) => {
      console.log('Game updated:', gameData);
      setAvailableGames(prev => 
        prev.map(game => game.id === gameData.id ? gameData : game)
      );
    });

    socket.on('gameEnded', (data: { gameId: string }) => {
      console.log('Game ended:', data.gameId);
      setAvailableGames(prev => 
        prev.map(game => 
          game.id === data.gameId 
            ? { ...game, status: 'finished' as const }
            : game
        )
      );
    });

    return () => {
      socket.off('gameList');
      socket.off('gameListUpdate');
      socket.off('gameUpdate');
      socket.off('gameEnded');
    };
  }, [socket]);

  // Auto-refresh functionality
  useEffect(() => {
    if (autoRefresh && socket) {
      refreshIntervalRef.current = setInterval(() => {
        socket.emit('requestGameList');
      }, 3000); // Refresh every 3 seconds
    } else if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefresh, socket]);

  // Filter games based on search and status
  const filteredGames = availableGames.filter(game => {
    const matchesSearch = game.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         game.settings.gameMode.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || game.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Refresh games manually
  const refreshGames = () => {
    if (socket) {
      setLoading(true);
      socket.emit('requestGameList');
    }
  };

  // Join game as spectator
  const joinGame = (gameId: string) => {
    router.push(`/spectator/${gameId}`);
  };

  // Get status badge styling
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'in-progress':
        return 'bg-green-600 text-green-100';
      case 'waiting':
        return 'bg-yellow-600 text-yellow-100';
      case 'finished':
        return 'bg-gray-600 text-gray-100';
      default:
        return 'bg-gray-600 text-gray-100';
    }
  };

  // Get team stats for display
  const getTeamStats = (game: SpectatorGame, team: 'red' | 'blue') => {
    if (!game || !game.players || !Array.isArray(game.players)) {
      return {
        players: 0,
        alive: 0,
        score: 0
      };
    }

    const teamPlayers = game.players.filter(p => p && p.team === team);
    return {
      players: teamPlayers.length,
      alive: teamPlayers.filter(p => p.isAlive).length,
      score: game.score?.[team] || 0
    };
  };

  // Format duration
  const formatDuration = (startTime: number) => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000 / 60);
    return `${elapsed}m`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">Laser Tag Spectator</h1>
              <p className="text-gray-400">Watch live games and see player statistics in real-time</p>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Connection status */}
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-500' : 
                  connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-sm capitalize">{connectionStatus}</span>
              </div>
              
              {/* Refresh button */}
              <button
                onClick={refreshGames}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors inline-flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
          
          {/* Search and filters */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search games..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Games</option>
                  <option value="waiting">Waiting</option>
                  <option value="in-progress">Live</option>
                  <option value="finished">Finished</option>
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-sm">Auto Refresh</span>
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`w-10 h-6 rounded-full transition-colors ${
                    autoRefresh ? 'bg-blue-600' : 'bg-gray-600'
                  } relative`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full transition-transform ${
                    autoRefresh ? 'translate-x-5' : 'translate-x-0.5'
                  } absolute top-1`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto p-6">
        {loading && availableGames.length === 0 ? (
          <div className="flex items-center justify-center min-h-[50vh]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold mb-2">Loading Games...</h2>
              <p className="text-gray-400">Fetching available games</p>
            </div>
          </div>
        ) : filteredGames.length === 0 ? (
          <div className="text-center py-12">
            <Gamepad2 className="h-16 w-16 text-gray-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">
              {availableGames.length === 0 ? 'No Games Available' : 'No Games Match Your Filter'}
            </h2>
            <p className="text-gray-400 mb-6">
              {availableGames.length === 0 
                ? 'There are currently no active games to spectate.'
                : 'Try adjusting your search or filter criteria.'
              }
            </p>
            {availableGames.length === 0 && (
              <button
                onClick={refreshGames}
                className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg transition-colors inline-flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Check Again
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredGames.map((game) => (
              <div
                key={game.id}
                className="bg-gray-800 border border-gray-700 rounded-lg p-6 hover:border-gray-600 transition-colors"
              >
                {/* Game header */}
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-semibold mb-1">{game.name}</h3>
                    <p className="text-gray-400 text-sm">{game.settings.gameMode}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-sm font-medium ${getStatusBadge(game.status)}`}>
                    {game.status === 'in-progress' ? 'LIVE' : game.status}
                  </span>
                </div>

                {/* Game stats */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-red-900/30 border border-red-700 rounded p-3">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-400">{getTeamStats(game, 'red').score}</div>
                      <div className="text-sm text-red-300">Red Team</div>
                      <div className="text-xs text-gray-400">
                        {getTeamStats(game, 'red').alive}/{getTeamStats(game, 'red').players} alive
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-blue-900/30 border border-blue-700 rounded p-3">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-400">{getTeamStats(game, 'blue').score}</div>
                      <div className="text-sm text-blue-300">Blue Team</div>
                      <div className="text-xs text-gray-400">
                        {getTeamStats(game, 'blue').alive}/{getTeamStats(game, 'blue').players} alive
                      </div>
                    </div>
                  </div>
                </div>

                {/* Game info */}
                <div className="space-y-2 mb-6 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Players:</span>
                    <span>{game.players.length}/{game.settings.maxPlayers}</span>
                  </div>
                  {game.startTime && game.status === 'in-progress' && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Duration:</span>
                      <span>{formatDuration(game.startTime)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-400">Mode:</span>
                    <span>{game.settings.gameMode}</span>
                  </div>
                </div>

                {/* Action button */}
                <button
                  onClick={() => joinGame(game.id)}
                  disabled={connectionStatus !== 'connected'}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Eye className="h-4 w-4" />
                  {game.status === 'in-progress' ? 'Watch Live' : 'Spectate'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Stats summary */}
        {availableGames.length > 0 && (
          <div className="mt-8 bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Game Statistics</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-blue-400">
                  {availableGames.length}
                </div>
                <div className="text-sm text-gray-400">Total Games</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-400">
                  {availableGames.filter(g => g.status === 'in-progress').length}
                </div>
                <div className="text-sm text-gray-400">Live Games</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-yellow-400">
                  {availableGames.filter(g => g.status === 'waiting').length}
                </div>
                <div className="text-sm text-gray-400">Waiting</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-400">
                  {availableGames.reduce((sum, g) => sum + g.players.length, 0)}
                </div>
                <div className="text-sm text-gray-400">Total Players</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
