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

    socket.on('playerHealthUpdate', (data: { gameId: string; playerId: string; health: number; isAlive: boolean }) => {
      if (data.gameId === gameId && currentGame) {
        setCurrentGame(prev => ({
          ...prev!,
          players: prev!.players.map(player => 
            player.id === data.playerId 
              ? { ...player, health: data.health, isAlive: data.isAlive }
              : player
          )
        }));
      }
    });

    socket.on('playerScoreUpdate', (data: { gameId: string; playerId: string; tags: number; deaths: number }) => {
      if (data.gameId === gameId && currentGame) {
        setCurrentGame(prev => ({
          ...prev!,
          players: prev!.players.map(player => 
            player.id === data.playerId 
              ? { ...player, tags: data.tags, deaths: data.deaths }
              : player
          )
        }));
      }
    });

    socket.on('gameScoreUpdate', (data: { gameId: string; score: { red: number; blue: number } }) => {
      if (data.gameId === gameId && currentGame) {
        setCurrentGame(prev => ({
          ...prev!,
          score: data.score
        }));
      }
    });

    socket.on('cameraFeedUpdate', (feeds: CameraFeed[]) => {
      setCameraFeeds(feeds);
    });

    socket.on('cameraStreamStart', (data: { playerId: string; playerName: string; type: 'environment' | 'face'; isActive: boolean }) => {
      setCameraFeeds(prev => {
        const existingIndex = prev.findIndex(feed => feed.playerId === data.playerId && feed.type === data.type);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = { ...updated[existingIndex], isActive: data.isActive };
          return updated;
        } else {
          return [...prev, {
            playerId: data.playerId,
            playerName: data.playerName,
            type: data.type,
            isActive: data.isActive
          }];
        }
      });
    });

    socket.on('cameraStreamStop', (data: { playerId: string; type: 'environment' | 'face'; isActive: boolean }) => {
      setCameraFeeds(prev => prev.map(feed => 
        feed.playerId === data.playerId && feed.type === data.type
          ? { ...feed, isActive: data.isActive }
          : feed
      ));
    });

    socket.on('cameraFrame', (data: { playerId: string; frame: string; timestamp: number }) => {
      setCameraFeeds(prev => prev.map(feed => 
        feed.playerId === data.playerId
          ? { ...feed, lastFrame: data.frame }
          : feed
      ));
    });

    socket.on('cameraFrame', (data: { playerId: string; frame: string; timestamp: number }) => {
      setCameraFrames(prev => ({
        ...prev,
        [data.playerId]: data.frame
      }));
    });

    socket.on('gameEnded', (data: { gameId: string }) => {
      if (data.gameId === gameId) {
        setCurrentGame(prev => prev ? { ...prev, status: 'finished' } : null);
      }
    });

    return () => {
      socket.off('spectatorGameUpdate');
      socket.off('playerHealthUpdate');
      socket.off('playerScoreUpdate');
      socket.off('gameScoreUpdate');
      socket.off('cameraFeedUpdate');
      socket.off('cameraStreamStart');
      socket.off('cameraStreamStop');
      socket.off('cameraFrame');
      socket.off('gameEnded');
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
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/spectator')}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <div>
              <h1 className="text-2xl font-bold">
                {currentGame ? currentGame.name : 'Spectator View'}
              </h1>
              {currentGame && (
                <p className="text-gray-400">
                  {currentGame.settings.gameMode} • {currentGame.players.length}/{currentGame.settings.maxPlayers} players
                </p>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Share button */}
            <button
              onClick={shareSpectatorLink}
              className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg transition-colors inline-flex items-center gap-2"
              title="Share spectator link"
            >
              {shareUrlCopied ? (
                <>
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-green-500">Copied!</span>
                </>
              ) : (
                <>
                  <Share2 className="h-4 w-4" />
                  <span>Share</span>
                </>
              )}
            </button>
            
            {/* Connection status */}
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${
                connectionStatus === 'connected' ? 'bg-green-500' : 
                connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
              }`} />
              <span className="text-sm capitalize">{connectionStatus}</span>
            </div>
            
            {/* Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
                title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {!currentGame ? (
        <div className="max-w-4xl mx-auto p-6">
          <div className="text-center mb-8">
            <div className="inline-flex items-center px-4 py-2 bg-blue-900/30 border border-blue-700 rounded-full mb-4">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse mr-2"></div>
              <span className="text-blue-300 font-medium">Spectating</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Joining Game Spectator Room</h2>
            <p className="text-gray-400 mb-4">Loading game information...</p>
            <div className="text-sm text-gray-500 font-mono bg-gray-800 inline-block px-3 py-1 rounded">
              Game ID: {gameId}
            </div>
          </div>

          {/* Basic spectator info while loading */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-red-900/20 border border-red-700 rounded-xl p-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-red-400 mb-2">-</div>
                <h3 className="text-xl font-semibold text-red-300 mb-2">Red Team</h3>
                <div className="text-sm text-gray-400">Waiting for player data...</div>
              </div>
            </div>

            <div className="bg-blue-900/20 border border-blue-700 rounded-xl p-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-400 mb-2">-</div>
                <h3 className="text-xl font-semibold text-blue-300 mb-2">Blue Team</h3>
                <div className="text-sm text-gray-400">Waiting for player data...</div>
              </div>
            </div>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold mb-2">Loading Game Data</h3>
              <p className="text-gray-400 text-sm">
                {connectionStatus === 'connected' 
                  ? 'Connected to server • Requesting game information...'
                  : connectionStatus === 'connecting'
                  ? 'Connecting to game server...'
                  : 'Connection lost • Trying to reconnect...'
                }
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto p-6">
          {/* Waiting game lobby view */}
          {currentGame.status === 'waiting' ? (
            <>
              {/* Game preparation header */}
              <div className="text-center mb-8">
                <div className="inline-flex items-center px-4 py-2 bg-yellow-900/30 border border-yellow-700 rounded-full mb-4">
                  <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse mr-2"></div>
                  <span className="text-yellow-300 font-medium">Game Preparing</span>
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Players are joining the lobby</h2>
                <p className="text-gray-400">Watch as players join and get ready for battle</p>
              </div>

              {/* Game info summary for waiting */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                  <div className="text-center">
                    <Users className="h-8 w-8 text-blue-400 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-white">{currentGame.players.length}</div>
                    <div className="text-sm text-gray-400">of {currentGame.settings.maxPlayers} players</div>
                  </div>
                </div>
                
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                  <div className="text-center">
                    <Play className="h-8 w-8 text-green-400 mx-auto mb-2" />
                    <div className="text-lg font-bold text-white">{currentGame.settings.gameMode}</div>
                    <div className="text-sm text-gray-400">Game Mode</div>
                  </div>
                </div>
                
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                  <div className="text-center">
                    <AlertCircle className="h-8 w-8 text-yellow-400 mx-auto mb-2" />
                    <div className="text-lg font-bold text-yellow-300">Waiting</div>
                    <div className="text-sm text-gray-400">for more players</div>
                  </div>
                </div>
              </div>

              {/* Player lobby list */}
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-8">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-semibold">Players in Lobby</h3>
                  <div className="text-sm text-gray-400">
                    {currentGame.players.length} players joined
                  </div>
                </div>
                
                {currentGame.players.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="h-12 w-12 text-gray-500 mx-auto mb-3" />
                    <p className="text-gray-400">No players have joined yet</p>
                    <p className="text-gray-500 text-sm">Waiting for players to join the game...</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {currentGame.players.map((player, index) => (
                      <div 
                        key={player.id}
                        className={`border rounded-lg p-4 ${
                          player.team === 'red' 
                            ? 'bg-red-900/20 border-red-700' 
                            : 'bg-blue-900/20 border-blue-700'
                        } relative`}
                      >
                        {/* New player animation */}
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-ping"></div>
                        
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h4 className="font-semibold text-white">{player.name}</h4>
                            <span className={`text-xs px-2 py-1 rounded ${
                              player.team === 'red' ? 'bg-red-700 text-red-100' : 'bg-blue-700 text-blue-100'
                            }`}>
                              {player.team} team
                            </span>
                          </div>
                          <div className="text-green-400">
                            <Activity className="h-4 w-4" />
                          </div>
                        </div>
                        
                        <div className="text-sm text-gray-400">
                          <div className="flex justify-between mb-1">
                            <span>Status:</span>
                            <span className="text-green-400">Ready</span>
                          </div>
                          {player.shirtColor && (
                            <div className="flex justify-between">
                              <span>Shirt:</span>
                              <span className="capitalize">{player.shirtColor}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Waiting for game start */}
              <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-6 text-center">
                <div className="animate-pulse mb-4">
                  <div className="w-16 h-16 bg-yellow-400/20 rounded-full mx-auto flex items-center justify-center">
                    <Play className="h-8 w-8 text-yellow-400" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-yellow-300 mb-2">Waiting for Game to Start</h3>
                <p className="text-gray-400 mb-4">
                  The host will start the game once enough players have joined and are ready.
                </p>
                <div className="text-sm text-gray-500">
                  Need at least 2 players to start • {Math.max(0, 2 - currentGame.players.length)} more needed
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Live/finished game view */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {/* Red team */}
                <div className="bg-red-900/30 border border-red-700 rounded-lg p-6">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-red-400 mb-2">
                      {currentGame.score.red}
                    </div>
                    <h3 className="text-xl font-semibold text-red-300 mb-4">Red Team</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Players:</span>
                        <span>{getTeamStats('red').players}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Alive:</span>
                        <span className="text-green-400">{getTeamStats('red').alive}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total Tags:</span>
                        <span>{getTeamStats('red').totalTags}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Game info */}
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                  <div className="text-center">
                    <div className={`text-2xl font-bold mb-2 ${
                      currentGame.status === 'in-progress' ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {currentGame.status === 'in-progress' ? 'LIVE' : 'FINISHED'}
                    </div>
                    <h3 className="text-lg font-semibold mb-4">Game Status</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Mode:</span>
                    <span>{currentGame.settings.gameMode}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Players:</span>
                    <span>{currentGame.players.length}/{currentGame.settings.maxPlayers}</span>
                  </div>
                  {currentGame.startTime && (
                    <div className="flex justify-between">
                      <span>Duration:</span>
                      <span>{Math.floor((Date.now() - currentGame.startTime) / 60000)}m</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Blue team */}
            <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-400 mb-2">
                  {currentGame.score.blue}
                </div>
                <h3 className="text-xl font-semibold text-blue-300 mb-4">Blue Team</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Players:</span>
                    <span>{getTeamStats('blue').players}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Alive:</span>
                    <span className="text-green-400">{getTeamStats('blue').alive}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Tags:</span>
                    <span>{getTeamStats('blue').totalTags}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Players grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
            {currentGame.players.map((player) => (
              <div
                key={player.id}
                className={`border rounded-lg p-4 ${
                  player.team === 'red' 
                    ? 'bg-red-900/20 border-red-700' 
                    : 'bg-blue-900/20 border-blue-700'
                } ${!player.isAlive ? 'opacity-50' : ''}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="font-semibold">{player.name}</h4>
                    <span className={`text-sm px-2 py-1 rounded ${
                      player.team === 'red' ? 'bg-red-700 text-red-100' : 'bg-blue-700 text-blue-100'
                    }`}>
                      {player.team}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {player.isAlive ? (
                      <Heart className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    )}
                  </div>
                </div>
                
                {/* Health bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Health</span>
                    <span>{player.health}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        player.health > 60 ? 'bg-green-500' :
                        player.health > 30 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.max(0, player.health)}%` }}
                    />
                  </div>
                </div>
                
                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Target className="h-3 w-3" />
                    <span>{player.tags} tags</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    <span>{player.deaths} deaths</span>
                  </div>
                </div>
                
                {/* Camera feeds */}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setSelectedFeed(player.id)}
                    className={`flex-1 p-2 rounded text-xs transition-colors ${
                      cameraFrames[player.id] 
                        ? 'bg-green-700 hover:bg-green-600' 
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    <Camera className="h-3 w-3 mx-auto mb-1" />
                    {cameraFrames[player.id] ? 'Live' : 'Offline'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Camera feeds section */}
          {showCameraFeeds && Object.keys(cameraFrames).length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">Live Player Views</h3>
                <button
                  onClick={() => setShowCameraFeeds(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <Minimize2 className="h-5 w-5" />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(cameraFrames).map(([playerId, frame]) => {
                  const player = currentGame?.players.find(p => p.id === playerId);
                  if (!player) return null;
                  
                  return (
                    <div key={playerId} className="relative">
                      <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden">
                        {frame ? (
                          <img
                            src={frame}
                            alt={`${player.name}'s view`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <CameraOff className="h-8 w-8 text-gray-500" />
                          </div>
                        )}
                      </div>
                      
                      <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded text-sm">
                        <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                          player.team === 'red' ? 'bg-red-500' : 'bg-blue-500'
                        }`}></span>
                        {player.name}
                      </div>
                      
                      <div className="absolute top-2 right-2 flex gap-1">
                        <div className="bg-black/70 px-2 py-1 rounded text-xs">
                          {player.health}HP
                        </div>
                        {frame && (
                          <div className="bg-green-600 px-2 py-1 rounded text-xs">
                            LIVE
                          </div>
                        )}
                      </div>
                      
                      <button
                        onClick={() => setSelectedFeed(playerId)}
                        className="absolute top-2 left-2 p-1 bg-black/70 rounded hover:bg-black/90 transition-colors"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Settings */}
          <div className="mt-8 bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Spectator Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center justify-between">
                <span>Auto Refresh</span>
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    autoRefresh ? 'bg-blue-600' : 'bg-gray-600'
                  } relative`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                    autoRefresh ? 'translate-x-6' : 'translate-x-0.5'
                  } absolute top-0.5`} />
                </button>
              </div>
              
              <div className="flex items-center justify-between">
                <span>Show Camera Feeds</span>
                <button
                  onClick={() => setShowCameraFeeds(!showCameraFeeds)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    showCameraFeeds ? 'bg-blue-600' : 'bg-gray-600'
                  } relative`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                    showCameraFeeds ? 'translate-x-6' : 'translate-x-0.5'
                  } absolute top-0.5`} />
                </button>
              </div>
              
              <div className="flex items-center justify-between">
                <span>Refresh Rate</span>
                <select
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                >
                  <option value={1000}>1s</option>
                  <option value={2000}>2s</option>
                  <option value={5000}>5s</option>
                  <option value={10000}>10s</option>
                </select>
              </div>
            </div>
          </div>
              </>
            )}
        </div>
      )}
    </div>
  );
}
