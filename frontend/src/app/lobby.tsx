"use client";
import React, { useState, useEffect, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import { 
  Users, Play, Plus, Crown, RefreshCw, AlertCircle, Wifi, WifiOff, 
  ArrowLeft, Shield, Zap, MessageSquare, Settings, LogOut, UserPlus
} from 'lucide-react';

interface Player {
  id: string;
  name: string;
  isHost: boolean;
  team: 'red' | 'blue';
  health: number;
}

interface GameSettings {
  maxPlayers: number;
  gameMode: string;
}

interface GameState {
  id: string;
  name: string;
  players: Player[];
  status: 'waiting' | 'in-progress' | 'finished';
  settings: GameSettings;
}

interface GameCreatedData {
  gameId: string;
  isHost: boolean;
  gameState: GameState;
}

interface GameJoinedData {
  gameId: string;
  isHost: boolean;
  gameState: GameState;
}

const Lobby = () => {
  // State
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [screen, setScreen] = useState<'home' | 'gameList' | 'lobby'>('home');
  const [playerName, setPlayerName] = useState('');
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [availableGames, setAvailableGames] = useState<GameState[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingGames, setLoadingGames] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [fadeScreen, setFadeScreen] = useState(false);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'info' | 'error'} | null>(null);

  // Connect to Socket.IO server
  useEffect(() => {
    setConnectionStatus('connecting');
    
    // Use current protocol and hostname, proxy through nginx
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const socketUrl = `${protocol}//${window.location.host}`;
    
    const newSocket: Socket = io(socketUrl, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      path: '/socket.io/',
    });
    
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnectionStatus('connected');
      setErrorMsg(null);
      showNotification('Connected to server', 'success');
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnectionStatus('disconnected');
      showNotification('Disconnected from server', 'error');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setConnectionStatus('disconnected');
      setErrorMsg('Failed to connect to server. Please try again later.');
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;

    socket.on('gameCreated', (data: GameCreatedData) => {
      setGameId(data.gameId);
      setIsHost(data.isHost);
      setGameState(data.gameState);
      changeScreen('lobby');
      setErrorMsg(null);
      showNotification('Game created successfully!', 'success');
    });

    socket.on('gameJoined', (data: GameJoinedData) => {
      setGameId(data.gameId);
      setIsHost(data.isHost);
      setGameState(data.gameState);
      changeScreen('lobby');
      setErrorMsg(null);
      showNotification('Joined game successfully!', 'success');
    });

    socket.on('gameStateUpdate', (updatedGameState: GameState) => {
      setGameState(updatedGameState);
    });

    socket.on('gameList', (games: GameState[]) => {
      setAvailableGames(games);
      setLoadingGames(false);
    });

    socket.on('error', (message: string) => {
      setErrorMsg(message);
      showNotification(message, 'error');
      setTimeout(() => setErrorMsg(null), 5000);
    });

    // Request the initial game list
    socket.emit('requestGameList');

    // Cleanup
    return () => {
      socket.off('gameCreated');
      socket.off('gameJoined');
      socket.off('gameStateUpdate');
      socket.off('gameList');
      socket.off('error');
    };
  }, [socket]);

  // Helper for animated screen transitions
  const changeScreen = (newScreen: 'home' | 'gameList' | 'lobby') => {
    setFadeScreen(true);
    setTimeout(() => {
      setScreen(newScreen);
      setFadeScreen(false);
    }, 300);
  };

  // Helper for showing notifications
  const showNotification = (message: string, type: 'success' | 'info' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Action handlers
  const handleCreateGame = useCallback(() => {
    if (!socket || !playerName.trim()) {
      setErrorMsg('Please enter your name first');
      return;
    }
    
    setErrorMsg(null);
    socket.emit('createGame', {
      playerName: playerName.trim(),
      gameSettings: { maxPlayers: 8, gameMode: 'team-deathmatch' },
    });
    showNotification('Creating game...', 'info');
  }, [socket, playerName]);

  const handleJoinGame = useCallback((id: string) => {
    if (!socket || !playerName.trim()) {
      setErrorMsg('Please enter your name first');
      return;
    }
    
    setErrorMsg(null);
    socket.emit('joinGame', { gameId: id, playerName: playerName.trim() });
    showNotification('Joining game...', 'info');
  }, [socket, playerName]);

  const handleLeaveGame = useCallback(() => {
    if (!socket || !gameId) return;
    
    socket.emit('leaveGame', gameId);
    setGameId(null);
    setGameState(null);
    setIsHost(false);
    changeScreen('home');
    setShowConfirmation(false);
    showNotification('Left the game', 'info');
  }, [socket, gameId]);

  const handleStartGame = useCallback(() => {
    if (!socket || !gameId || !isHost) return;
    
    socket.emit('startGame', gameId);
    showNotification('Starting game...', 'info');
  }, [socket, gameId, isHost]);

  const handleSwitchTeam = useCallback(() => {
    if (!socket || !gameId) return;
    
    socket.emit('switchTeam', gameId);
    showNotification('Switching team...', 'info');
  }, [socket, gameId]);

  const handleRefreshGames = useCallback(() => {
    if (!socket) return;
    
    setLoadingGames(true);
    socket.emit('requestGameList');
    showNotification('Refreshing game list...', 'info');
    // Add a timeout to set loadingGames back to false in case server doesn't respond
    setTimeout(() => setLoadingGames(false), 3000);
  }, [socket]);

  // Render connection status indicator
  const renderConnectionStatus = () => {
    return (
      <div className="absolute top-3 right-3 flex items-center z-10">
        {connectionStatus === 'connected' ? (
          <div className="flex items-center text-green-400 bg-black/40 px-2 py-1 rounded-full">
            <Wifi size={16} className="mr-1 animate-pulse" />
            <span className="text-xs">Connected</span>
          </div>
        ) : connectionStatus === 'connecting' ? (
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

  // Render notification toast
  const renderNotification = () => {
    if (!notification) return null;
    
    const bgColor = notification.type === 'success' 
      ? 'bg-green-500' 
      : notification.type === 'error' 
        ? 'bg-red-500' 
        : 'bg-blue-500';
    
    return (
      <div className={`fixed bottom-4 left-1/2 transform -translate-x-1/2 ${bgColor} text-white px-4 py-2 rounded-md shadow-lg z-50 animate-fadeIn flex items-center`}>
        {notification.type === 'success' && <Zap className="mr-2" size={16} />}
        {notification.type === 'error' && <AlertCircle className="mr-2" size={16} />}
        {notification.type === 'info' && <MessageSquare className="mr-2" size={16} />}
        {notification.message}
      </div>
    );
  };

  // Render confirmation dialog
  const renderConfirmDialog = () => {
    if (!showConfirmation) return null;
    
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fadeIn">
        <div className="bg-gray-900 border border-cyan-500 rounded-lg p-6 max-w-sm w-full mx-4 shadow-[0_0_15px_rgba(0,255,255,0.5)]">
          <h3 className="text-xl font-bold text-white mb-4">Leave Game?</h3>
          <p className="text-gray-300 mb-6">Are you sure you want to leave the current game?</p>
          <div className="flex justify-end space-x-3">
            <button 
              onClick={() => setShowConfirmation(false)}
              className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition"
            >
              Cancel
            </button>
            <button 
              onClick={handleLeaveGame}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500 transition"
            >
              Leave Game
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Render error message
  const renderError = () => {
    if (!errorMsg) return null;
    
    return (
      <div className="bg-red-900/70 border border-red-500 text-red-100 px-4 py-3 rounded-md relative mb-6 flex items-center animate-pulse">
        <AlertCircle size={18} className="mr-2" />
        {errorMsg}
      </div>
    );
  };

  // CSS classes for the main container based on current screen
  const containerClass = `
    min-h-screen w-full 
    bg-gradient-to-b from-gray-900 to-black 
    text-white 
    transition-opacity duration-300 ease-in-out
    ${fadeScreen ? 'opacity-0' : 'opacity-100'}
    relative
    overflow-hidden
  `;

  // Main container with styling that applies to all screens
  const pageContainer = (content: React.ReactNode) => (
    <div className={containerClass}>
      <div className="absolute inset-0 bg-[url('/laser-grid.svg')] opacity-20 z-0"></div>
      {renderConnectionStatus()}
      {renderNotification()}
      {renderConfirmDialog()}
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 min-h-screen flex flex-col items-center justify-center">
        {content}
      </div>
    </div>
  );

  // Render home screen
  if (screen === 'home') {
    return pageContainer(
      <>
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
            LASER TAG
          </h1>
          <p className="text-cyan-300 text-xl">Multiplayer Lobby</p>
        </div>
        
        {renderError()}
        
        <div className="w-full max-w-md bg-gray-800/70 backdrop-blur-sm rounded-lg border border-cyan-800 shadow-[0_0_20px_rgba(0,255,255,0.15)] p-6">
          <div className="mb-6">
            <label htmlFor="playerName" className="block text-cyan-300 text-sm font-medium mb-1">
              Player Identification
            </label>
            <input
              id="playerName"
              type="text"
              placeholder="Enter your callsign"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full p-3 bg-gray-900 border border-cyan-700 rounded-md focus:ring-2 focus:ring-cyan-500 focus:outline-none text-white placeholder-gray-500"
              disabled={connectionStatus !== 'connected'}
            />
          </div>
          
          <button
            onClick={handleCreateGame}
            disabled={!playerName.trim() || connectionStatus !== 'connected'}
            className="w-full flex justify-center items-center px-4 py-3 mb-4 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-md hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-cyan-600 disabled:hover:to-blue-600 transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] font-medium"
          >
            <Plus className="mr-2" /> Create New Game
          </button>
          
          <button
            onClick={() => {
              changeScreen('gameList');
              handleRefreshGames();
            }}
            disabled={connectionStatus !== 'connected'}
            className="w-full flex justify-center items-center px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-md hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] font-medium"
          >
            <Users className="mr-2" /> Join Existing Game
          </button>
        </div>
      </>
    );
  }

  // Render game list
  if (screen === 'gameList') {
    return pageContainer(
      <>
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
            Available Games
          </h1>
          <p className="text-purple-300">Join an existing match</p>
        </div>
        
        {renderError()}
        
        <div className="w-full max-w-2xl">
          <div className="flex justify-between items-center mb-6">
            <button
              onClick={() => changeScreen('home')}
              className="flex items-center px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-all duration-200"
            >
              <ArrowLeft size={18} className="mr-2" /> Back
            </button>
            <button
              onClick={handleRefreshGames}
              disabled={loadingGames || connectionStatus !== 'connected'}
              className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:bg-indigo-800 transition-all duration-200"
            >
              <RefreshCw size={18} className={`mr-2 ${loadingGames ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          
          {loadingGames ? (
            <div className="flex flex-col items-center justify-center py-12 bg-gray-800/70 backdrop-blur-sm rounded-lg border border-indigo-800 shadow-[0_0_20px_rgba(105,90,255,0.15)]">
              <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
              <p className="text-indigo-300">Scanning for active games...</p>
            </div>
          ) : availableGames.length === 0 ? (
            <div className="text-center py-12 bg-gray-800/70 backdrop-blur-sm rounded-lg border border-indigo-800 shadow-[0_0_20px_rgba(105,90,255,0.15)]">
              <div className="mb-6">
                <svg className="mx-auto h-16 w-16 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <h3 className="mt-2 text-xl font-medium text-white">No games found</h3>
                <p className="mt-1 text-indigo-300">Be the first to create a game!</p>
              </div>
              <button
                onClick={handleCreateGame}
                disabled={!playerName.trim() || connectionStatus !== 'connected'}
                className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-md hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 transition-all duration-200"
              >
                <Plus size={18} className="mr-2" /> Create Game
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availableGames.map((game) => (
                <div 
                  key={game.id} 
                  className="bg-gray-800/70 backdrop-blur-sm rounded-lg border border-indigo-800 p-5 hover:shadow-[0_0_20px_rgba(105,90,255,0.3)] transition-all duration-300 hover:-translate-y-1"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-xl text-white mb-1">{game.name}</h3>
                      <p className="text-gray-400 text-sm mb-3">
                        Mode: <span className="text-indigo-300 font-medium">{game.settings.gameMode}</span>
                      </p>
                    </div>
                    <div className="bg-indigo-900/70 text-indigo-300 px-3 py-1 rounded-full text-xs font-medium">
                      {game.players.length}/{game.settings.maxPlayers}
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 mb-4">
                    {game.players.map((player) => (
                      <div 
                        key={player.id} 
                        className={`px-2 py-1 rounded-full text-xs ${
                          player.team === 'red' 
                            ? 'bg-red-900/50 text-red-300 border border-red-800' 
                            : 'bg-blue-900/50 text-blue-300 border border-blue-800'
                        } flex items-center`}
                      >
                        {player.name}
                        {player.isHost && <Crown size={12} className="ml-1 text-yellow-500" />}
                      </div>
                    ))}
                  </div>
                  
                  <button
                    onClick={() => handleJoinGame(game.id)}
                    disabled={connectionStatus !== 'connected'}
                    className="w-full flex justify-center items-center px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-md hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 transition-all duration-200"
                  >
                    <UserPlus size={18} className="mr-2" /> Join Match
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  // Render lobby screen
  if (screen === 'lobby' && gameState) {
    // Count players by team
    const redTeam = gameState.players.filter(p => p.team === 'red');
    const blueTeam = gameState.players.filter(p => p.team === 'blue');
    const currentPlayer = gameState.players.find(p => p.id === socket?.id);
    
    return pageContainer(
      <>
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold mb-1 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-green-400">
            {gameState.name}
          </h1>
          <div className={`inline-block px-4 py-1 rounded-full text-sm font-medium ${
            gameState.status === 'waiting' 
              ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-800' 
              : 'bg-green-900/50 text-green-300 border border-green-800'
          }`}>
            {gameState.status === 'waiting' ? '⏳ Waiting for players' : '🎮 Game in progress'}
          </div>
          
          <p className="text-gray-400 mt-2">
            Game ID: <span className="text-gray-300 font-mono">{gameId}</span>
          </p>
        </div>
        
        {renderError()}

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
              {/* Red Team */}
              <div className="relative">
                <div className="absolute inset-0 bg-red-900/20 rounded-lg -z-10"></div>
                <div className="p-4 border border-red-900/70 rounded-lg bg-gradient-to-br from-red-950/60 to-black/40">
                  <h3 className="text-xl font-bold text-red-400 flex items-center mb-3 pb-2 border-b border-red-900/30">
                    <Shield className="mr-2" size={20} />
                    Red Team ({redTeam.length})
                  </h3>
                  <ul className="space-y-2 min-h-[120px]">
                    {redTeam.length === 0 ? (
                      <li className="text-gray-500 text-center italic py-2">No players yet</li>
                    ) : redTeam.map(player => (
                      <li 
                        key={player.id} 
                        className={`flex items-center justify-between p-2 rounded-lg ${
                          player.id === socket?.id ? 'bg-red-900/30 border border-red-800/50' : ''
                        }`}
                      >
                        <div className="flex items-center">
                          <div className="w-8 h-8 rounded-full bg-red-800 flex items-center justify-center mr-3">
                            {player.name.charAt(0).toUpperCase()}
                          </div>
                          <span>{player.name}</span>
                          {player.isHost && 
                            <div className="ml-2 flex items-center text-yellow-500">
                              <Crown size={14} className="mr-1" />
                              <span className="text-xs">Host</span>
                            </div>
                          }
                        </div>
                        {player.id === socket?.id && 
                          <span className="text-xs bg-white/10 px-2 py-0.5 rounded">You</span>
                        }
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              
              {/* Blue Team */}
              <div className="relative">
                <div className="absolute inset-0 bg-blue-900/20 rounded-lg -z-10"></div>
                <div className="p-4 border border-blue-900/70 rounded-lg bg-gradient-to-br from-blue-950/60 to-black/40">
                  <h3 className="text-xl font-bold text-blue-400 flex items-center mb-3 pb-2 border-b border-blue-900/30">
                    <Shield className="mr-2" size={20} />
                    Blue Team ({blueTeam.length})
                  </h3>
                  <ul className="space-y-2 min-h-[120px]">
                    {blueTeam.length === 0 ? (
                      <li className="text-gray-500 text-center italic py-2">No players yet</li>
                    ) : blueTeam.map(player => (
                      <li 
                        key={player.id} 
                        className={`flex items-center justify-between p-2 rounded-lg ${
                          player.id === socket?.id ? 'bg-blue-900/30 border border-blue-800/50' : ''
                        }`}
                      >
                        <div className="flex items-center">
                          <div className="w-8 h-8 rounded-full bg-blue-800 flex items-center justify-center mr-3">
                            {player.name.charAt(0).toUpperCase()}
                          </div>
                          <span>{player.name}</span>
                          {player.isHost && 
                            <div className="ml-2 flex items-center text-yellow-500">
                              <Crown size={14} className="mr-1" />
                              <span className="text-xs">Host</span>
                            </div>
                          }
                        </div>
                        {player.id === socket?.id && 
                          <span className="text-xs bg-white/10 px-2 py-0.5 rounded">You</span>
                        }
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
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
                    <button
                      onClick={handleStartGame}
                      disabled={gameState.players.length < 2 || connectionStatus !== 'connected'}
                      className="w-full flex justify-center items-center px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-md hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      <Play className="mr-2" /> Start Game
                      {gameState.players.length < 2 && 
                        <span className="ml-1 text-xs">(Need at least 2 players)</span>
                      }
                    </button>
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
          
          {/* Game in progress overlay */}
          {gameState.status === 'in-progress' && (
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-20 backdrop-blur-sm">
              <div className="bg-gray-900 border-2 border-green-500 rounded-lg p-6 max-w-md mx-4 text-center">
                <h3 className="text-2xl font-bold text-green-400 mb-2">Game in Progress!</h3>
                <p className="text-gray-300 mb-6">The game has started. Get ready for battle!</p>
                <button
                  onClick={() => setShowConfirmation(true)}
                  className="px-6 py-3 bg-red-700 text-white rounded-md hover:bg-red-600 transition-all duration-200"
                >
                  Leave Game
                </button>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  // Loading or error state
  return pageContainer(
    <div className="flex flex-col items-center justify-center">
      <div className="animate-spin rounded-full h-20 w-20 border-t-2 border-b-2 border-cyan-500 mb-6"></div>
      <h1 className="text-4xl font-bold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
        LASER TAG
      </h1>
      {renderError() || (
        <p className="text-cyan-300 animate-pulse">Initializing system...</p>
      )}
    </div>
  );
};

export default Lobby;