"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import io, { Socket } from 'socket.io-client';
import Webcam from "react-webcam";
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { 
  Users, Plus, Eye, Crown, RefreshCw, AlertCircle, Wifi, WifiOff, 
  ArrowLeft, Shield, Zap, MessageSquare, Settings, LogOut, UserPlus, Camera, X, Play, Pause
} from 'lucide-react';

import { ColorScanner, ColorSample, AveragedColorResult, getColorStyle } from '@/utils/colorDetection';
import { requestCameraPermission, isMobileDevice } from '@/utils/deviceUtils';
import { drawDetections } from '@/utils/poseDetection';

import {
  ColorConfirmationView,
  GameView,
  LobbyView,
  ConnectionStatus,
  Notification,
  ConfirmationDialog,
  SCAN_DURATION,
  SAMPLE_INTERVAL,
  formatColorDisplay,
  getSocketUrl
} from '@/components/lobby';

import type { Player, GameState } from '@/components/lobby/types';

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

// Player Color Display Component
const PlayerColorDisplay: React.FC<{ color: string | undefined, displayType: 'dot' | 'text' | 'both' }> = ({ color, displayType }) => {
  // Format the color for display
  const formatColor = (color: string | undefined): string => {
    if (!color) return '';
    
    // Check if it looks like an object that was stringified
    if (color === '[object Object]' || color.includes('[object Object]')) {
      return 'RGB color';
    }
    
    // Check if it's already a valid CSS color
    if (color.startsWith('rgb(') || color.startsWith('#') || 
        ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'white', 'black', 'gray'].includes(color)) {
      return color;
    }
    
    // Try to parse it if it looks like a JSON string
    if (color.startsWith('{') && color.endsWith('}')) {
      try {
        const parsed = JSON.parse(color);
        if (parsed.r !== undefined && parsed.g !== undefined && parsed.b !== undefined) {
          return `rgb(${parsed.r},${parsed.g},${parsed.b})`;
        }
      } catch (e) {
        console.log('Failed to parse color JSON:', color);
      }
    }
    
    return color;
  };
  
  const formattedColor = formatColor(color);
  
  if (!formattedColor) return null;
  
  // Determine text color based on background (for readability)
  const getTextColor = (bgColor: string): string => {
    // Simple algorithm: if it contains RGB values, check if it's light or dark
    if (bgColor.startsWith('rgb(')) {
      const rgbMatch = bgColor.match(/rgb\((\d+),(\d+),(\d+)\)/);
      if (rgbMatch) {
        const [_, r, g, b] = rgbMatch.map(Number);
        // Formula to determine if a color is light or dark
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128 ? 'text-black' : 'text-white';
      }
    }
    
    // Default based on common colors
    const darkColors = ['blue', 'green', 'purple', 'black', 'red'];
    const lightColors = ['yellow', 'pink', 'white'];
    
    if (darkColors.some(c => bgColor.includes(c))) return 'text-white';
    if (lightColors.some(c => bgColor.includes(c))) return 'text-black';
    
    return 'text-white'; // Default
  };
  
  const textColor = getTextColor(formattedColor);
  
  // Render based on display type
  if (displayType === 'dot') {
    return (
      <div 
        className="w-4 h-4 rounded-full border-2 border-white"
        style={{ backgroundColor: formattedColor }}
        title={`Color: ${formattedColor}`}
      />
    );
  } else if (displayType === 'text') {
    return (
      <span className="text-xs">
        {formattedColor}
      </span>
    );
  } else { // 'both'
    return (
      <div className="flex items-center space-x-1">
        <div 
          className="w-3 h-3 rounded-full border border-white/50"
          style={{ backgroundColor: formattedColor }}
        />
        <span className="text-xs text-gray-400">
          {formattedColor}
        </span>
      </div>
    );
  }
};

const Lobby = () => {
  const router = useRouter();
  
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
  const [selectedColor, setSelectedColor] = useState<string>('');
  const [isSubmittingColor, setIsSubmittingColor] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  
  // Advanced color scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [colorSamples, setColorSamples] = useState<ColorSample[]>([]);
  const [finalResult, setFinalResult] = useState<AveragedColorResult | null>(null);
  
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorScannerRef = useRef<ColorScanner | null>(null);
  const [poseModel, setPoseModel] = useState<poseDetection.PoseDetector | null>(null);
  const [currentPoses, setCurrentPoses] = useState<poseDetection.Pose[]>([]);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);

  // Constants for scanning
  const SCAN_DURATION = 1000; // 1 second in milliseconds
  const SAMPLE_INTERVAL = 50; // Sample every 50ms (20 samples per second)

  // Show notification helper
  const showNotification = useCallback((message: string, type: 'success' | 'info' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  // Format color for display
  const formatColorDisplay = (color: string | undefined): string => {
    if (!color) return '';
    
    // Check if it looks like an object that was stringified
    if (color === '[object Object]' || color.includes('[object Object]')) {
      return 'RGB color';
    }
    
    // Check if it's already in RGB format
    if (color.startsWith('rgb(')) {
      return color;
    }
    
    // Try to parse it if it looks like a JSON string
    if (color.startsWith('{') && color.endsWith('}')) {
      try {
        const parsed = JSON.parse(color);
        if (parsed.r !== undefined && parsed.g !== undefined && parsed.b !== undefined) {
          return `rgb(${parsed.r},${parsed.g},${parsed.b})`;
        }
      } catch (e) {
        // Parsing failed, continue
      }
    }
    
    return color;
  };
  
  // TensorFlow.js helper functions for pose detection and color analysis

  // Connect to Socket.IO server
  useEffect(() => {
    if (typeof window === 'undefined') return; // Only run on client

    setConnectionStatus('connecting');
    
    // Determine the correct socket URL based on environment
    let socketUrl: string;
    
    if (process.env.NODE_ENV === 'development') {
      // Local development - connect directly to backend
      socketUrl = 'http://localhost:3001';
    } else {
      // Production - use current protocol and hostname, proxy through nginx
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      socketUrl = `${protocol}//${window.location.host}`;
    }
    
    console.log(`Connecting to socket server: ${socketUrl}`);
    
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

  // Load pose detection model and request camera permission
  useEffect(() => {
    async function initializeCV() {
      try {
        // Ensure TensorFlow is ready
        await tf.ready();
        console.log("TensorFlow.js is ready");

        // Request camera permission
        const hasPermission = await requestCameraPermission(showNotification);
        setHasCameraPermission(hasPermission);

        // Load pose detection model
        console.log("Loading MoveNet model...");
        const modelConfig: poseDetection.MoveNetModelConfig = {
          modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
          enableSmoothing: false,
          minPoseScore: 0.1,
          enableTracking: false,
        };
        
        const model = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          modelConfig
        );
        setPoseModel(model);
        console.log("MoveNet model loaded successfully");
        showNotification("AI model loaded successfully!", "success");
      } catch (error) {
        console.error("Error initializing computer vision:", error);
        showNotification("Failed to load AI model. Please refresh the page.", "error");
      }
    }

    initializeCV();
  }, [showNotification]);

  // Pose detection loop when camera is active (either in color scanning or during gameplay)
  useEffect(() => {
    let detectionInterval: NodeJS.Timeout | null = null;

    const detectPoses = async () => {
      if (!poseModel || !webcamRef.current?.video) return;
      
      // Check if camera should be active (color scanning OR game in progress)
      const shouldDetectPoses = showCamera || (gameState?.status === 'in-progress');
      if (!shouldDetectPoses) return;

      const video = webcamRef.current.video;
      if (video.readyState !== 4) return;

      try {
        const poses = await poseModel.estimatePoses(video, {
          flipHorizontal: false,
          maxPoses: 1
        });

        setCurrentPoses(poses);
      } catch (error) {
        console.error("Error detecting poses:", error);
      }
    };

    // Start detection if camera should be active
    const shouldDetectPoses = showCamera || (gameState?.status === 'in-progress');
    if (shouldDetectPoses && poseModel) {
      detectionInterval = setInterval(detectPoses, 100); // 10 FPS
    }

    return () => {
      if (detectionInterval) clearInterval(detectionInterval);
    };
  }, [showCamera, poseModel, gameState?.status]);

  // Drawing/rendering loop for pose overlay (color scanning or gameplay)
  useEffect(() => {
    let renderFrameId: number | null = null;
    
    const renderFrame = () => {
      // Check if camera should be rendering (color scanning OR game in progress)
      const shouldRender = showCamera || (gameState?.status === 'in-progress');
      
      if (currentPoses.length > 0 && shouldRender) {
        drawDetections(currentPoses, canvasRef, webcamRef, true, 80);
      }
      
      renderFrameId = requestAnimationFrame(renderFrame);
    };
    
    // Start rendering if camera should be active
    const shouldRender = showCamera || (gameState?.status === 'in-progress');
    if (shouldRender) {
      renderFrameId = requestAnimationFrame(renderFrame);
    }
    
    return () => {
      if (renderFrameId !== null) {
        cancelAnimationFrame(renderFrameId);
      }
    };
  }, [currentPoses, showCamera, gameState?.status]);

  // Initialize ColorScanner when pose model and camera are ready
  useEffect(() => {
    if (poseModel && webcamRef.current?.video && showCamera) {
      const videoElement = webcamRef.current.video;
      
      if (!colorScannerRef.current) {
        colorScannerRef.current = new ColorScanner({
          scanDuration: SCAN_DURATION,
          sampleInterval: SAMPLE_INTERVAL
        });
      }
      
      colorScannerRef.current.initialize(poseModel, videoElement);
      
      // Update the color scanner with player colors if game state is available
      if (gameState && gameState.players) {
        const playerColors = gameState.players.map(player => ({
          id: player.id,
          name: player.name,
          color: player.shirtColor || player.team // Use shirtColor if available, otherwise use team
        }));
        
        colorScannerRef.current.updatePlayerColors(playerColors);
      }
      
      colorScannerRef.current.setCallbacks({
        onProgress: (progress, samples) => {
          setScanProgress(progress);
          setColorSamples(samples);
        },
        onComplete: (result) => {
          setIsScanning(false);
          setFinalResult(result);
          
          if (!result.dominantColor) {
            // No match found
            showNotification(
              "No matching player color detected. Please try again or adjust lighting.", 
              "error"
            );
            return;
          }
          
          // Use the matched player name if available
          const detectedInfo = result.matchedPlayer 
            ? `${result.dominantColor} (matched to ${result.matchedPlayer.name})` 
            : result.dominantColor;
            
          showNotification(`Color scanning complete! Detected: ${detectedInfo}`, "success");
        },
        onError: (error) => {
          setIsScanning(false);
          showNotification(error, "error");
        }
      });
    }
  }, [poseModel, showCamera, SCAN_DURATION, SAMPLE_INTERVAL, showNotification, gameState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (colorScannerRef.current) {
        colorScannerRef.current.dispose();
      }
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
      // Store player name in localStorage for reconnection purposes
      localStorage.setItem('playerName', playerName);
      showNotification('Game created successfully!', 'success');
    });

    socket.on('gameJoined', (data: GameJoinedData) => {
      setGameId(data.gameId);
      setIsHost(data.isHost);
      setGameState(data.gameState);
      changeScreen('lobby');
      setErrorMsg(null);
      // Store player name in localStorage for reconnection purposes
      localStorage.setItem('playerName', playerName);
      showNotification('Joined game successfully!', 'success');
    });

    socket.on('gameStateUpdate', (updatedGameState: GameState) => {
      const wasInProgress = gameState?.status === 'in-progress';
      const isNowInProgress = updatedGameState.status === 'in-progress';
      
      setGameState(updatedGameState);
      
      // If game just started (transitioned to in-progress), show game view inline
      if (!wasInProgress && isNowInProgress) {
        // Find our player in the updated game state based on our socket ID
        const currentPlayer = updatedGameState.players.find(p => p.id === socket.id);
        
        // If we can't find by socket ID, try to find by name as a fallback
        const currentPlayerName = currentPlayer?.name || playerName.trim();
        const currentGameId = updatedGameState.id;
        
        // ALWAYS store the player name in localStorage for any future reconnection needs
        if (currentPlayerName) {
          console.log(`Storing player name in localStorage: ${currentPlayerName}`);
          localStorage.setItem('playerName', currentPlayerName);
        } else {
          console.warn('No player name available to store in localStorage');
        }
        
        // Log the game start information
        console.log('Game started, showing inline game view with:', { 
          currentGameId, 
          currentPlayerName,
          socketId: socket.id,
          playerFound: !!currentPlayer,
          totalPlayers: updatedGameState.players.length,
          allPlayers: updatedGameState.players.map(p => `${p.name}(${p.id})`)
        });
        
        if (currentGameId && currentPlayerName) {
          // Show game started notification but stay on same page
          showNotification('Game started! Loading camera view...', 'success');
          
          // No redirect - the game view will render inline when status is 'in-progress'
        } else {
          console.error('Missing gameId or playerName for game start:', { currentGameId, currentPlayerName });
          showNotification('Error: Missing game information to start', 'error');
        }
      }
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

    socket.on('colorConfirmationStarted', (data: { gameState: GameState; currentTarget: Player }) => {
      setGameState(data.gameState);
      showNotification(`Color confirmation started! Current target: ${data.currentTarget.name}`, 'info');
    });

    socket.on('nextColorTarget', (data: { gameState: GameState; currentTarget: Player }) => {
      setGameState(data.gameState);
      showNotification(`Next target: ${data.currentTarget.name}`, 'info');
    });

    socket.on('allColorsConfirmed', (data: { gameState: GameState; playerColors: Array<{name: string, color: string}> }) => {
      setGameState(data.gameState);
      showNotification('All shirt colors confirmed! Ready to start game.', 'success');
    });

    socket.on('colorConfirmationUpdate', (data: { gameState: GameState; confirmationsReceived: number; confirmationsNeeded: number }) => {
      setGameState(data.gameState);
    });

    socket.on('colorConfirmationSkipped', (data: { gameState: GameState }) => {
      setGameState(data.gameState);
      showNotification('Color confirmation skipped', 'info');
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
      socket.off('colorConfirmationStarted');
      socket.off('nextColorTarget');
      socket.off('allColorsConfirmed');
      socket.off('colorConfirmationUpdate');
      socket.off('colorConfirmationSkipped');
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

  const handleStartColorConfirmation = useCallback(() => {
    if (!socket || !gameId || !isHost) return;
    
    socket.emit('startColorConfirmation', gameId);
    showNotification('Starting color confirmation...', 'info');
  }, [socket, gameId, isHost]);

  const handleSkipColorConfirmation = useCallback(() => {
    if (!socket || !gameId || !isHost) return;
    
    socket.emit('skipColorConfirmation', gameId);
  }, [socket, gameId, isHost]);

  const handleSubmitColorConfirmation = useCallback((targetPlayerId: string, color: string) => {
    if (!socket || !gameId || !color) return;
    
    setIsSubmittingColor(true);
    
    // Function to format RGB values as string
    const formatRgbColor = (rgb: { r: number; g: number; b: number }) => {
      return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    };
    
    // Check if we have a valid finalResult with a matchedPlayer
    if (finalResult?.matchedPlayer) {
      // Format the color as RGB string
      const colorString = formatRgbColor(finalResult.averageRgb);
      
      socket.emit('submitColorConfirmation', { 
        gameId, 
        targetPlayerId, 
        detectedColor: colorString
      });
    } else if (finalResult && !finalResult.dominantColor) {
      // No match was found - show error and don't submit
      showNotification(
        "No matching player color was detected. Please try again or adjust lighting.", 
        "error"
      );
      setTimeout(() => setIsSubmittingColor(false), 500);
      return;
    } else {
      // Fallback to manual color selection
      socket.emit('submitColorConfirmation', { 
        gameId, 
        targetPlayerId, 
        detectedColor: color
      });
    }
    
    setSelectedColor('');
    setShowCamera(false);
    setFinalResult(null);
    setTimeout(() => setIsSubmittingColor(false), 1000);
  }, [socket, gameId, finalResult, showNotification]);

  const handleGoToSpectator = useCallback(() => {
    router.push('/spectator');
  }, [router]);

  // Start color scanning
  const startColorScan = useCallback(() => {
    if (isScanning || !colorScannerRef.current) return;
    
    setIsScanning(true);
    setScanProgress(0);
    setColorSamples([]);
    setFinalResult(null);
    
    showNotification("Starting 1-second color scan...", "info");
    colorScannerRef.current.startScan();
  }, [isScanning, showNotification]);

  // Stop color scanning
  const stopColorScan = useCallback(() => {
    if (!isScanning || !colorScannerRef.current) return;
    
    colorScannerRef.current.stopScan();
    setIsScanning(false);
  }, [isScanning]);

  // Render functions have been replaced with components

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
      <ConnectionStatus status={connectionStatus} />
      <Notification notification={notification} />
      <ConfirmationDialog 
        show={showConfirmation} 
        onConfirm={handleLeaveGame} 
        onCancel={() => setShowConfirmation(false)} 
      />
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
            className="w-full flex justify-center items-center px-4 py-3 mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-md hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] font-medium"
          >
            <Users className="mr-2" /> Join Existing Game
          </button>
          
          <button
            onClick={handleGoToSpectator}
            className="w-full flex justify-center items-center px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-md hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] font-medium"
          >
            <Eye className="mr-2" /> Spectate Games
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

  // Regular lobby view when not in color confirmation phase and not in progress
  if (screen === 'lobby' && gameState) {
    // Count players by team
    const redTeam = gameState.players.filter(p => p.team === 'red');
    const blueTeam = gameState.players.filter(p => p.team === 'blue');
    const currentPlayer = gameState.players.find(p => p.id === socket?.id);

    // Color confirmation phase
    if (gameState.status === 'confirming-colors' && gameState.confirmationPhase) {
      const currentTarget = gameState.players[gameState.confirmationPhase.currentTargetIndex];
      const isCurrentPlayerTarget = currentTarget?.id === socket?.id;
      const hasAlreadyConfirmed = gameState.confirmationPhase.confirmations[`${socket?.id}->${currentTarget?.id}`];
      
      const availableColors = [
        { name: 'Red', value: 'red', bg: 'bg-red-500', border: 'border-red-400' },
        { name: 'Blue', value: 'blue', bg: 'bg-blue-500', border: 'border-blue-400' },
        { name: 'Green', value: 'green', bg: 'bg-green-500', border: 'border-green-400' },
        { name: 'Yellow', value: 'yellow', bg: 'bg-yellow-500', border: 'border-yellow-400' },
        { name: 'Purple', value: 'purple', bg: 'bg-purple-500', border: 'border-purple-400' },
        { name: 'Orange', value: 'orange', bg: 'bg-orange-500', border: 'border-orange-400' },
        { name: 'Pink', value: 'pink', bg: 'bg-pink-500', border: 'border-pink-400' },
        { name: 'White', value: 'white', bg: 'bg-white', border: 'border-gray-300', text: 'text-black' },
        { name: 'Black', value: 'black', bg: 'bg-black', border: 'border-gray-600' },
        { name: 'Gray', value: 'gray', bg: 'bg-gray-500', border: 'border-gray-400' }
      ];

      return pageContainer(
        <ColorConfirmationView 
          gameState={gameState}
          socket={socket}
          isHost={isHost}
          webcamRef={webcamRef}
          canvasRef={canvasRef}
          hasCameraPermission={hasCameraPermission}
          showCamera={showCamera}
          isScanning={isScanning}
          scanProgress={scanProgress}
          colorSamples={colorSamples}
          finalResult={finalResult}
          currentPoses={currentPoses}
          poseModel={poseModel}
          isSubmittingColor={isSubmittingColor}
          handleSkipColorConfirmation={handleSkipColorConfirmation}
          handleSubmitColorConfirmation={handleSubmitColorConfirmation}
          startColorScan={startColorScan}
          stopColorScan={stopColorScan}
          setShowCamera={setShowCamera}
          setShowConfirmation={setShowConfirmation}
          showNotification={showNotification}
        />
      );
    }
    
    // Game View - when game is in progress
    if (gameState.status === 'in-progress') {
      const currentPlayer = gameState.players.find(p => p.id === socket?.id);
      
      return pageContainer(
        <GameView 
          gameState={gameState}
          currentPlayer={currentPlayer}
          playerName={playerName}
          webcamRef={webcamRef}
          canvasRef={canvasRef}
          hasCameraPermission={hasCameraPermission}
          setHasCameraPermission={setHasCameraPermission}
          currentPoses={currentPoses}
          setShowConfirmation={setShowConfirmation}
          showNotification={showNotification}
        />
      );
    }
    
    // Regular lobby view
    return pageContainer(
      <LobbyView 
        gameState={gameState}
        gameId={gameId}
        socket={socket}
        isHost={isHost}
        connectionStatus={connectionStatus}
        handleSwitchTeam={handleSwitchTeam}
        handleStartColorConfirmation={handleStartColorConfirmation}
        handleStartGame={handleStartGame}
        setShowConfirmation={setShowConfirmation}
      />
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
