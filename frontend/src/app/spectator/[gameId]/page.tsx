"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import io, { Socket } from 'socket.io-client';
import { 
  Users, Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  Camera, CameraOff, Activity, Heart, Target, Zap, AlertCircle,
  ArrowLeft, Share2, ExternalLink, Copy, Check
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
  points: number;
  lives: number;
  status: 'alive' | 'dead';
  shirtColor?: string;
  position?: { x: number; y: number };
  lastActivity?: string;
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

interface CameraFeed {
  playerId: string;
  playerName: string;
  type: 'environment' | 'face';
  stream?: MediaStream;
  isActive: boolean;
  lastFrame?: string; // Add for image-based streaming
}

export default function SpectatorGameView() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const gameId = params.gameId as string;
  
  // Socket and game state
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [currentGame, setCurrentGame] = useState<SpectatorGame | null>(null);
  const [gameNotFound, setGameNotFound] = useState(false);
  const [loadingGame, setLoadingGame] = useState(true);
  
  // Camera feeds state
  const [cameraFeeds, setCameraFeeds] = useState<CameraFeed[]>([]);
  const [cameraFrames, setCameraFrames] = useState<{ [key: string]: string }>({});
  const [selectedFeed, setSelectedFeed] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  
  // UI state
  const [showCameraFeeds, setShowCameraFeeds] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(2000);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  
  // Refs
  const videoRefs = useRef<{ [key: string]: HTMLVideoElement | null }>({});
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Share functionality
  const shareSpectatorLink = async () => {
    if (typeof window === 'undefined') return;
    const url = window.location.href;
    try {
      if (navigator?.clipboard) {
        await navigator.clipboard.writeText(url);
        setShareUrlCopied(true);
        setTimeout(() => setShareUrlCopied(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  // Show notification for waiting room updates
  const showWaitingRoomNotification = (message: string) => {
    if (currentGame?.status === 'waiting') {
      console.log(`Waiting Room: ${message}`);
      // Could add toast notifications here in the future
    }
  };

  // Connect to Socket.IO server and join specific game
  useEffect(() => {
    if (typeof window === 'undefined' || !gameId) return;

    setConnectionStatus('connecting');
    setLoadingGame(true);
    
    let socketUrl: string;
    if (process.env.NODE_ENV === 'development') {
      socketUrl = 'http://localhost:3001';
    } else {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      socketUrl = `${protocol}//${window.location.host}`;
    }
    
    console.log(`Spectator connecting to: ${socketUrl} for game: ${gameId}`);
    
    const newSocket: Socket = io(socketUrl, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      path: '/socket.io/',
    });
    
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Spectator connected to server');
      setConnectionStatus('connected');
      
      // Join as spectator for specific game
      console.log(`Joining game as spectator: ${gameId}`);
      newSocket.emit('spectatorJoin', { gameId });
      newSocket.emit('requestGameData', { gameId });
      newSocket.emit('requestCameraFeeds', { gameId });
      
      // Also try alternative event names in case backend uses different naming
      newSocket.emit('joinGameAsSpectator', gameId);
      newSocket.emit('spectatorWatchGame', gameId);
    });

    newSocket.on('disconnect', () => {
      console.log('Spectator disconnected from server');
      setConnectionStatus('disconnected');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Spectator connection error:', error);
      setConnectionStatus('disconnected');
    });

    // Handle game-specific responses
    newSocket.on('gameData', (gameData: SpectatorGame) => {
      console.log('Received gameData:', gameData);
      if (gameData && gameData.id === gameId) {
        setCurrentGame(gameData);
        setGameNotFound(false);
        setLoadingGame(false);
      }
    });

    newSocket.on('gameNotFound', (data: { gameId: string }) => {
      console.log('Game not found:', data);
      if (data.gameId === gameId) {
        setGameNotFound(true);
        setLoadingGame(false);
      }
    });

    // Listen for any events that might contain game data
    newSocket.on('spectatorGameUpdate', (gameData: SpectatorGame) => {
      console.log('Received spectatorGameUpdate:', gameData);
      if (gameData && gameData.id === gameId) {
        setCurrentGame(gameData);
        setGameNotFound(false);
        setLoadingGame(false);
      }
    });

    // Listen for game list updates which might contain our game
    newSocket.on('gameList', (games: SpectatorGame[]) => {
      console.log('Received gameList:', games);
      const ourGame = games.find(game => game.id === gameId);
      if (ourGame) {
        setCurrentGame(ourGame);
        setGameNotFound(false);
        setLoadingGame(false);
      } else if (games.length > 0) {
        // If we got a game list but our game isn't in it, it might not exist
        setGameNotFound(true);
        setLoadingGame(false);
      }
    });

    // For any game, reduce loading time and show basic info quickly
    const loadingTimeout = setTimeout(() => {
      console.log('Loading timeout reached, stopping loading state');
      // If no game data received yet, assume it might be a waiting game
      setLoadingGame(false);
    }, 2000); // Give 2 seconds for server response

    return () => {
      newSocket.disconnect();
      clearTimeout(loadingTimeout);
    };
  }, [gameId]);

  // Socket event handlers for real-time updates
  useEffect(() => {
    if (!socket || !gameId) return;

    socket.on('spectatorGameUpdate', (gameData: SpectatorGame) => {
      if (gameData.id === gameId) {
        const prevPlayerCount = currentGame?.players.length || 0;
        const newPlayerCount = gameData.players.length;
        
        // Notify about player changes in waiting room
        if (gameData.status === 'waiting') {
          if (newPlayerCount > prevPlayerCount) {
            const newPlayer = gameData.players[gameData.players.length - 1];
            showWaitingRoomNotification(`${newPlayer?.name} joined the game!`);
          } else if (newPlayerCount < prevPlayerCount) {
            showWaitingRoomNotification(`A player left the game.`);
          }
        }
        
        setCurrentGame(gameData);
      }
    });

    socket.on('playerHealthUpdate', (data: { playerId: string; health: number }) => {
      if (currentGame) {
        setCurrentGame(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map(player =>
              player.id === data.playerId
                ? { ...player, health: data.health, isAlive: data.health > 0 }
                : player
            )
          };
        });
      }
    });

    socket.on('playerScoreUpdate', (data: { playerId: string; points: number }) => {
      if (currentGame) {
        setCurrentGame(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map(player =>
              player.id === data.playerId
                ? { ...player, points: data.points }
                : player
            )
          };
        });
      }
    });

    socket.on('playerDeath', (data: { playerId: string; lives: number }) => {
      if (currentGame) {
        setCurrentGame(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map(player =>
              player.id === data.playerId
                ? { ...player, lives: data.lives, status: 'dead', isAlive: false }
                : player
            )
          };
        });
      }
    });

    socket.on('playerRespawn', (data: { playerId: string }) => {
      if (currentGame) {
        setCurrentGame(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map(player =>
              player.id === data.playerId
                ? { ...player, status: 'alive', health: 100, isAlive: true }
                : player
            )
          };
        });
      }
    });

    socket.on('playerDamaged', (data: { targetPlayerId: string; damage: number; attackerName: string }) => {
      if (currentGame) {
        setCurrentGame(prev => {
          if (!prev) return prev;
          const targetPlayer = prev.players.find(p => p.id === data.targetPlayerId);
          if (!targetPlayer) return prev;
          
          return {
            ...prev,
            players: prev.players.map(player =>
              player.id === data.targetPlayerId
                ? {
                    ...player,
                    health: Math.max(0, player.health - data.damage),
                    lastActivity: `Damaged by ${data.attackerName}`
                  }
                : player
            )
          };
        });
      }
    });

    return () => {
      socket.off('playerHealthUpdate');
      socket.off('playerScoreUpdate');
      socket.off('playerDeath');
      socket.off('playerRespawn');
      socket.off('playerDamaged');
    };
  }, [socket, gameId, currentGame]);

  // Auto-refresh functionality
  useEffect(() => {
    if (autoRefresh && socket && gameId) {
      refreshIntervalRef.current = setInterval(() => {
        socket.emit('requestGameData', { gameId });
      }, refreshInterval);
    } else if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefresh, refreshInterval, socket, gameId]);

  // Camera feed management
  useEffect(() => {
    cameraFeeds.forEach(feed => {
      if (feed.stream && videoRefs.current[`${feed.playerId}-${feed.type}`]) {
        const videoElement = videoRefs.current[`${feed.playerId}-${feed.type}`];
        if (videoElement) {
          videoElement.srcObject = feed.stream;
          videoElement.muted = isMuted;
        }
      }
    });
  }, [cameraFeeds, isMuted]);

  // Handle fullscreen
  const toggleFullscreen = () => {
    if (typeof document === 'undefined') return;
    
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Get team stats
  const getTeamStats = (team: 'red' | 'blue') => {
    if (!currentGame) return { players: 0, alive: 0, totalTags: 0, totalDeaths: 0 };
    
    const teamPlayers = currentGame.players.filter(p => p.team === team);
    return {
      players: teamPlayers.length,
      alive: teamPlayers.filter(p => p.isAlive).length,
      totalTags: teamPlayers.reduce((sum, p) => sum + p.tags, 0),
      totalDeaths: teamPlayers.reduce((sum, p) => sum + p.deaths, 0),
    };
  };

  // Loading state
  if (loadingGame) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <h2 className="text-2xl font-bold mb-2">Loading Game...</h2>
          <p className="text-gray-400">Connecting to game {gameId}</p>
        </div>
      </div>
    );
  }

  // Game not found state
  if (gameNotFound) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Game Not Found</h2>
          <p className="text-gray-400 mb-6">
            The game "{gameId}" could not be found. It may have ended or the ID is incorrect.
          </p>
          <button
            onClick={() => router.push('/spectator')}
            className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Browse Available Games
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-bold">Game Spectator</h1>
          {currentGame && <span className="text-gray-400">ID: {currentGame.id}</span>}
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={shareSpectatorLink}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-md text-sm"
          >
            {shareUrlCopied ? 'Copied!' : 'Share Link'}
          </button>
          {connectionStatus === 'connected' ? (
            <span className="text-green-500">●</span>
          ) : (
            <span className="text-red-500">●</span>
          )}
        </div>
      </div>

      {!currentGame ? (
        <div className="max-w-4xl mx-auto p-6 text-center">
          <p className="text-xl text-gray-400">Loading game data...</p>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto p-6">
          {/* Game Status */}
          <div className="mb-8">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-red-900/30 p-4 rounded-lg">
                <h3 className="text-xl font-bold text-red-400 mb-2">Red Team</h3>
                <div className="text-2xl font-bold">{currentGame.score.red}</div>
              </div>
              <div className="bg-gray-800 p-4 rounded-lg text-center">
                <h3 className="text-lg font-semibold mb-2">Game Status</h3>
                <div className="text-xl capitalize">{currentGame.status}</div>
              </div>
              <div className="bg-blue-900/30 p-4 rounded-lg text-right">
                <h3 className="text-xl font-bold text-blue-400 mb-2">Blue Team</h3>
                <div className="text-2xl font-bold">{currentGame.score.blue}</div>
              </div>
            </div>
          </div>

          {/* Teams */}
          <div className="grid grid-cols-2 gap-8">
            {/* Red Team */}
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-red-400">Red Team Players</h3>
              {currentGame.players
                .filter(player => player.team === 'red')
                .map(player => (
                  <div
                    key={player.id}
                    className={`bg-gray-800 rounded-lg p-4 ${
                      !player.isAlive ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold">{player.name}</span>
                      <span className={player.isAlive ? 'text-green-500' : 'text-red-500'}>
                        ● {player.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-gray-400">Health</div>
                        <div className="relative w-full h-2 bg-gray-700 rounded-full mt-1">
                          <div
                            className="absolute left-0 top-0 h-2 bg-green-500 rounded-full transition-all duration-300"
                            style={{ width: `${player.health}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-400">Lives</div>
                        <div className="font-mono">{player.lives}</div>
                      </div>
                      <div>
                        <div className="text-gray-400">Tags</div>
                        <div className="font-mono">{player.tags}</div>
                      </div>
                      <div>
                        <div className="text-gray-400">Points</div>
                        <div className="font-mono">{player.points}</div>
                      </div>
                    </div>
                    {player.lastActivity && (
                      <div className="mt-2 text-sm text-gray-400">
                        {player.lastActivity}
                      </div>
                    )}
                  </div>
                ))}
            </div>

            {/* Blue Team */}
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-blue-400">Blue Team Players</h3>
              {currentGame.players
                .filter(player => player.team === 'blue')
                .map(player => (
                  <div
                    key={player.id}
                    className={`bg-gray-800 rounded-lg p-4 ${
                      !player.isAlive ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold">{player.name}</span>
                      <span className={player.isAlive ? 'text-green-500' : 'text-red-500'}>
                        ● {player.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-gray-400">Health</div>
                        <div className="relative w-full h-2 bg-gray-700 rounded-full mt-1">
                          <div
                            className="absolute left-0 top-0 h-2 bg-green-500 rounded-full transition-all duration-300"
                            style={{ width: `${player.health}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-400">Lives</div>
                        <div className="font-mono">{player.lives}</div>
                      </div>
                      <div>
                        <div className="text-gray-400">Tags</div>
                        <div className="font-mono">{player.tags}</div>
                      </div>
                      <div>
                        <div className="text-gray-400">Points</div>
                        <div className="font-mono">{player.points}</div>
                      </div>
                    </div>
                    {player.lastActivity && (
                      <div className="mt-2 text-sm text-gray-400">
                        {player.lastActivity}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
