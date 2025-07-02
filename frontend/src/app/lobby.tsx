"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import io, { Socket } from 'socket.io-client';
import Webcam from "react-webcam";
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { 
  Users, Play, Plus, Crown, RefreshCw, AlertCircle, Wifi, WifiOff, 
  ArrowLeft, Shield, Zap, MessageSquare, Settings, LogOut, UserPlus, Camera, X, Eye, Pause
} from 'lucide-react';
import { 
  ColorScanner, 
  ColorSample, 
  AveragedColorResult, 
  getColorStyle 
} from '@/utils/colorDetection';
import { requestCameraPermission, isMobileDevice } from '@/utils/deviceUtils';
import { drawDetections } from '@/utils/poseDetection';

interface Player {
  id: string;
  name: string;
  isHost: boolean;
  team: 'red' | 'blue';
  health: number;
  shirtColor?: string;
  isConfirmed?: boolean;
  // Game-related properties
  points?: number;
  lives?: number;
  status?: 'alive' | 'dead';
  weapon?: {
    type: string;
    damage: number;
    cost?: number;
  };
  powerUps?: Array<{
    type: string;
    active: boolean;
  }>;
}

interface GameSettings {
  maxPlayers: number;
  gameMode: string;
}

interface GameState {
  id: string;
  name: string;
  players: Player[];
  status: 'waiting' | 'confirming-colors' | 'in-progress' | 'finished';
  settings: GameSettings;
  confirmationPhase?: {
    currentTargetIndex: number;
    confirmations: { [key: string]: string };
    allConfirmed: boolean;
  };
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

  // Render lobby screen
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
        <>
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
              🎨 Color Confirmation
            </h1>
            <p className="text-purple-300 text-lg">Confirming shirt colors for accurate gameplay</p>
          </div>

          <div className="w-full max-w-2xl bg-gray-800/90 backdrop-blur-sm rounded-lg border border-purple-800 shadow-xl p-6">
            {/* Current target display */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 mb-4">
                <span className="text-2xl font-bold text-white">
                  {currentTarget?.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">
                {isCurrentPlayerTarget ? "You are the target!" : `Current Target: ${currentTarget?.name}`}
              </h2>
              <p className="text-gray-300">
                {isCurrentPlayerTarget 
                  ? "Stand still while others scan your shirt color" 
                  : "Look at the target's shirt and select the color you see"
                }
              </p>
            </div>

            {/* Progress indicator */}
            <div className="mb-6">
              <div className="flex justify-between text-sm text-gray-400 mb-2">
                <span>Progress</span>
                <span>{gameState.confirmationPhase.currentTargetIndex + 1} / {gameState.players.length}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${((gameState.confirmationPhase.currentTargetIndex + 1) / gameState.players.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Color detection or waiting state */}
            {isCurrentPlayerTarget ? (
              <div className="text-center py-8">
                <div className="animate-pulse text-6xl mb-4">👕</div>
                <h3 className="text-xl font-semibold text-white mb-2">Stay Still!</h3>
                <p className="text-gray-300 mb-4">Other players are scanning your shirt color with their cameras</p>
                <div className="mt-4 flex items-center justify-center space-x-2">
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                </div>
              </div>
            ) : hasAlreadyConfirmed ? (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">✅</div>
                <h3 className="text-xl font-semibold text-green-400 mb-2">Color Confirmed!</h3>
                <p className="text-gray-300">
                  You detected: <span className="font-semibold text-white">{hasAlreadyConfirmed}</span>
                </p>
                <p className="text-gray-400 text-sm mt-2">Waiting for other players...</p>
              </div>
            ) : !showCamera ? (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">📷</div>
                <h3 className="text-xl font-semibold text-white mb-4">
                  Scan {currentTarget?.name}'s Shirt Color
                </h3>
                <p className="text-gray-300 mb-6">
                  Use your camera to detect the target's shirt color automatically using AI pose detection
                </p>
                {hasCameraPermission === false ? (
                  <div className="bg-red-900/50 border border-red-500 text-red-100 p-4 rounded-lg mb-4">
                    <AlertCircle className="mx-auto mb-2" size={24} />
                    <p>Camera permission required for AI color detection</p>
                  </div>
                ) : hasCameraPermission === null ? (
                  <div className="bg-yellow-900/50 border border-yellow-500 text-yellow-100 p-4 rounded-lg mb-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-yellow-500 mx-auto mb-2"></div>
                    <p>Requesting camera permission...</p>
                  </div>
                ) : !poseModel ? (
                  <div className="bg-blue-900/50 border border-blue-500 text-blue-100 p-4 rounded-lg mb-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500 mx-auto mb-2"></div>
                    <p>Loading AI pose detection model...</p>
                  </div>
                ) : null}
                
                <button
                  onClick={async () => {
                    // Re-check camera permission if needed
                    if (hasCameraPermission === null || hasCameraPermission === false) {
                      const hasPermission = await requestCameraPermission(showNotification);
                      setHasCameraPermission(hasPermission);
                      if (!hasPermission) {
                        showNotification('Camera permission is required to scan shirt colors', 'error');
                        return;
                      }
                    }
                    setShowCamera(true);
                  }}
                  disabled={!poseModel || isSubmittingColor}
                  className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-semibold flex items-center justify-center mx-auto"
                >
                  <Camera className="mr-2" size={20} />
                  {!poseModel ? 'Loading AI Model...' : 'Start AI Camera Scan'}
                </button>
              </div>
            ) : (
              <div>
                <h3 className="text-lg font-semibold text-white mb-4 text-center">
                  Point your camera at {currentTarget?.name}'s shirt
                </h3>
                
                {/* Camera view */}
                <div className="relative mb-6 bg-black rounded-lg overflow-hidden">
                  {hasCameraPermission ? (
                    <Webcam
                      ref={webcamRef}
                      audio={false}
                      className="w-full h-64 object-cover"
                      screenshotFormat="image/jpeg"
                      videoConstraints={{
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: isMobileDevice() ? { ideal: "environment" } : { ideal: "user" }
                      }}
                      onUserMedia={(stream) => {
                        console.log("Camera access granted successfully");
                        console.log("Video track settings:", stream.getVideoTracks()[0].getSettings());
                      }}
                      onUserMediaError={(error) => {
                        console.error("Camera access error:", error);
                        
                        // Set permission to false and show error
                        setHasCameraPermission(false);
                        setShowCamera(false);
                        
                        // Determine error message based on error type
                        let errorMessage = 'Camera access failed. Please check permissions and try again.';
                        if (error instanceof DOMException) {
                          switch (error.name) {
                            case 'NotAllowedError':
                            case 'PermissionDeniedError':
                              errorMessage = 'Camera permission denied. Please allow camera access in browser settings.';
                              break;
                            case 'NotFoundError':
                            case 'DevicesNotFoundError':
                              errorMessage = 'No camera found. Please ensure a camera is connected.';
                              break;
                            case 'NotReadableError':
                            case 'TrackStartError':
                              errorMessage = 'Camera is already in use by another application.';
                              break;
                            case 'OverconstrainedError':
                            case 'ConstraintNotSatisfiedError':
                              errorMessage = 'Camera settings not supported. Please try again.';
                              break;
                            default:
                              if (error.message && error.message.includes('videosource')) {
                                errorMessage = 'Camera resource conflict. Please close other applications using the camera and try again.';
                              }
                              break;
                          }
                        }
                        
                        showNotification(errorMessage, 'error');
                      }}
                    />
                  ) : (
                    <div className="w-full h-64 bg-gray-800 flex items-center justify-center">
                      <div className="text-center">
                        <Camera className="mx-auto mb-4 text-gray-400" size={48} />
                        <p className="text-gray-400">Camera permission required for AI color detection</p>
                        <button
                          onClick={async () => {
                            const hasPermission = await requestCameraPermission(showNotification);
                            setHasCameraPermission(hasPermission);
                            if (hasPermission) {
                              showNotification('Camera permission granted! You can now start scanning.', 'success');
                              // Don't automatically restart camera, let user click "Start AI Camera Scan" again
                            } else {
                              showNotification('Camera permission denied. Please allow camera access in browser settings.', 'error');
                            }
                          }}
                          className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
                        >
                          Grant Camera Access
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* Pose detection overlay */}
                  <canvas
                    ref={canvasRef}
                    className="absolute top-0 left-0 w-full h-64 pointer-events-none"
                    style={{ mixBlendMode: 'normal' }}
                  />
                  
                  {/* Status overlay */}
                  <div className="absolute bottom-4 left-4 right-4 bg-black/80 text-white p-3 rounded-lg">
                    <p className="text-sm text-center">
                      {!hasCameraPermission 
                        ? "📷 Camera permission required"
                        : currentPoses.length === 0 
                          ? "🔍 Looking for person in frame..." 
                          : "✅ Person detected! AI analyzing torso area..."
                      }
                    </p>
                  </div>

                  {/* Close button */}
                  <button
                    onClick={() => {
                      setShowCamera(false);
                      if (isScanning) stopColorScan();
                    }}
                    className="absolute top-2 right-2 bg-black/60 text-white p-2 rounded-full hover:bg-black/80 transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Scan Progress */}
                {isScanning && (
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm text-gray-300">
                      <span>Scanning Progress</span>
                      <span>{Math.round(scanProgress)}%</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-green-500 to-blue-500 h-2 rounded-full transition-all duration-100"
                        style={{ width: `${scanProgress}%` }}
                      />
                    </div>
                    <div className="text-center text-sm text-gray-400">
                      Samples collected: {colorSamples.length}
                    </div>
                  </div>
                )}

                {/* Results */}
                {finalResult && (
                  <div className="bg-gray-700/50 rounded-lg p-4 space-y-4 mb-4">
                    <h4 className="font-semibold text-gray-300">Color Analysis Results</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Color Display */}
                      <div className="space-y-2">
                        <h5 className="text-sm font-semibold text-gray-300">Detected Color</h5>
                        <div className="flex items-center space-x-3">
                          <div 
                            className="w-12 h-12 rounded-lg border-2 border-gray-600"
                            style={getColorStyle(finalResult.averageRgb)}
                          />
                          <div>
                            <p className="font-bold text-white capitalize">{finalResult.dominantColor}</p>
                            <p className="text-xs text-gray-400">
                              RGB({finalResult.averageRgb.r}, {finalResult.averageRgb.g}, {finalResult.averageRgb.b})
                            </p>
                          </div>
                        </div>
                        
                        {/* Matched Player Info */}
                        {finalResult.matchedPlayer && (
                          <div className="mt-3 bg-blue-900/50 border border-blue-700 rounded-md p-2">
                            <p className="text-sm text-blue-200">Matched to player:</p>
                            <p className="font-bold text-blue-100">{finalResult.matchedPlayer.name}</p>
                            <p className="text-xs text-blue-300">
                              Match confidence: {Math.round((1 - finalResult.matchedPlayer.distance/100) * 100)}%
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Statistics */}
                      <div className="space-y-2">
                        <h5 className="text-sm font-semibold text-gray-300">Statistics</h5>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-400">Confidence:</span>
                            <span className="text-white">{Math.round(finalResult.confidence * 100)}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Samples:</span>
                            <span className="text-white">{finalResult.sampleCount}</span>
                          </div>
                          {finalResult.matchedPlayer && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Player Match:</span>
                              <span className="text-white">{finalResult.matchedPlayer.name}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Recent Samples */}
                    {colorSamples.length > 0 && (
                      <div>
                        <h5 className="text-sm font-semibold text-gray-300 mb-2">Sample History</h5>
                        <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                          {colorSamples.slice(-15).map((sample, index) => (
                            <div
                              key={index}
                              className="w-6 h-6 rounded border border-gray-600 flex-shrink-0"
                              style={getColorStyle(sample.rgb)}
                              title={`${sample.color} - Confidence: ${Math.round(sample.confidence * 100)}%`}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Control buttons */}
                <div className="space-y-3">
                  {!isScanning ? (
                    <button
                      onClick={startColorScan}
                      disabled={currentPoses.length === 0}
                      className="w-full flex justify-center items-center px-6 py-3 bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-lg hover:from-green-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-semibold"
                    >
                      <Play size={20} className="mr-2" />
                      Start 1-Second Color Scan
                    </button>
                  ) : (
                    <button
                      onClick={stopColorScan}
                      className="w-full flex justify-center items-center px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-all duration-200 font-semibold"
                    >
                      <Pause size={20} className="mr-2" />
                      Stop Scanning
                    </button>
                  )}

                  {finalResult && finalResult.confidence > 0.1 && (
                    <button
                      onClick={() => handleSubmitColorConfirmation(currentTarget.id, finalResult.dominantColor)}
                      disabled={isSubmittingColor}
                      className="w-full flex justify-center items-center px-6 py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-semibold"
                    >
                      {isSubmittingColor ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
                          Confirming...
                        </>
                      ) : (
                        <>
                          <Zap className="mr-2" size={20} />
                          Confirm {finalResult.dominantColor.charAt(0).toUpperCase() + finalResult.dominantColor.slice(1)}
                        </>
                      )}
                    </button>
                  )}

                  <button
                    onClick={() => setShowCamera(false)}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-all duration-200"
                  >
                    Cancel Scan
                  </button>
                </div>
              </div>
            )}

            {/* Player confirmation status */}
            <div className="mt-6 pt-6 border-t border-gray-700">
              <h4 className="text-sm font-medium text-gray-400 mb-3">Confirmation Status:</h4>
              <div className="grid grid-cols-2 gap-2">
                {gameState.players.map((player) => {
                  const isTarget = player.id === currentTarget?.id;
                  const hasConfirmed = gameState.confirmationPhase!.confirmations[`${player.id}->${currentTarget?.id}`];
                  
                  return (
                    <div 
                      key={player.id}
                      className={`flex items-center justify-between p-2 rounded-lg ${
                        isTarget 
                          ? 'bg-purple-900/30 border border-purple-800' 
                          : hasConfirmed 
                            ? 'bg-green-900/30 border border-green-800' 
                            : 'bg-gray-900/30 border border-gray-700'
                      }`}
                    >
                      <span className="text-sm text-white">{player.name}</span>
                      <span className="text-xs">
                        {isTarget 
                          ? '🎯 Target' 
                          : hasConfirmed 
                            ? '✅ Done' 
                            : '⏳ Waiting'
                        }
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Host controls */}
            {isHost && (
              <div className="mt-6 pt-6 border-t border-gray-700 flex justify-between">
                <button
                  onClick={handleSkipColorConfirmation}
                  className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-all duration-200"
                >
                  Skip Color Confirmation
                </button>
                <button
                  onClick={() => setShowConfirmation(true)}
                  className="px-4 py-2 bg-red-700 text-white rounded-lg hover:bg-red-600 transition-all duration-200"
                >
                  <LogOut className="mr-2" size={16} />
                  Leave Game
                </button>
              </div>
            )}
          </div>
        </>
      );
    }
    
    // Inline Game View - when game is in progress, show the game interface instead of lobby
    if (gameState.status === 'in-progress') {
      const currentPlayer = gameState.players.find(p => p.id === socket?.id);
      
      return pageContainer(
        <>
          <div className="text-center mb-6">
            <h1 className="text-4xl font-bold mb-1 text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-blue-400">
              🎯 {gameState.name}
            </h1>
            <div className="inline-block px-4 py-1 rounded-full text-sm font-medium bg-green-900/50 text-green-300 border border-green-800">
              🎮 Game in Progress
            </div>
            
            <p className="text-gray-400 mt-2">
              Player: <span className="text-white font-semibold">{currentPlayer?.name || playerName}</span> • 
              Team: <span className={`font-semibold ${currentPlayer?.team === 'red' ? 'text-red-400' : 'text-blue-400'}`}>
                {currentPlayer?.team?.toUpperCase() || 'Unknown'}
              </span>
            </p>
          </div>

          <div className="w-full max-w-4xl bg-gray-800/90 backdrop-blur-sm rounded-lg border border-green-800 shadow-xl overflow-hidden">
            {/* Game Status Header */}
            <div className="bg-gray-900/80 px-6 py-4 border-b border-gray-700">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-4">
                  <div className="text-green-400 font-semibold">🎯 Active Game</div>
                  <div className="text-gray-300">|</div>
                  <div className="text-gray-300">
                    Health: <span className={`font-bold ${
                      (currentPlayer?.health || 0) > 50 ? 'text-green-400' : 
                      (currentPlayer?.health || 0) > 20 ? 'text-yellow-400' : 'text-red-400'
                    }`}>{currentPlayer?.health || 0}</span>
                  </div>
                  <div className="text-gray-300">
                    Score: <span className="font-bold text-blue-400">{currentPlayer?.points || 0}</span>
                  </div>
                </div>
                <div className="text-sm text-gray-400">
                  Game ID: {gameState.id}
                </div>
              </div>
            </div>

            {/* Camera View for Pose Detection */}
            <div className="p-6">
              <div className="bg-black rounded-lg overflow-hidden border-4 border-green-500 mb-4">
                {hasCameraPermission ? (
                  <div className="relative">
                    <Webcam
                      ref={webcamRef}
                      audio={false}
                      className="w-full h-96 object-cover"
                      screenshotFormat="image/jpeg"
                      videoConstraints={{
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: isMobileDevice() ? { ideal: "environment" } : { ideal: "user" }
                      }}
                      onUserMedia={(stream) => {
                        console.log("Game camera access granted successfully");
                        console.log("Video track settings:", stream.getVideoTracks()[0].getSettings());
                      }}
                      onUserMediaError={(error) => {
                        console.error("Game camera access error:", error);
                        setHasCameraPermission(false);
                        
                        let errorMessage = 'Camera access failed during game.';
                        if (error instanceof DOMException) {
                          switch (error.name) {
                            case 'NotAllowedError':
                            case 'PermissionDeniedError':
                              errorMessage = 'Camera permission lost. Please allow camera access to continue playing.';
                              break;
                            case 'NotFoundError':
                            case 'DevicesNotFoundError':
                              errorMessage = 'No camera found. Please ensure a camera is connected.';
                              break;
                            case 'NotReadableError':
                            case 'TrackStartError':
                              errorMessage = 'Camera is being used by another app. Please close other camera apps.';
                              break;
                            default:
                              errorMessage = 'Camera error during game. Please refresh and try again.';
                              break;
                          }
                        }
                        
                        showNotification(errorMessage, 'error');
                      }}
                    />
                    
                    {/* Game UI Overlay */}
                    <div className="absolute inset-0 pointer-events-none">
                      {/* Crosshair and targeting */}
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                        <div className="w-32 h-32 border-4 border-green-400 bg-green-400/10 rounded-full relative">
                          {/* Crosshair */}
                          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                            <div className="w-8 h-1 bg-green-400"></div>
                            <div className="w-1 h-8 bg-green-400 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"></div>
                          </div>
                          
                          {/* Target label */}
                          <div className="absolute -bottom-10 left-1/2 transform -translate-x-1/2 text-center">
                            <div className="bg-green-400 text-black px-3 py-1 rounded-full text-sm font-bold">
                              🎯 AIM & SHOOT
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Person detection indicator */}
                      {currentPoses.length > 0 && (
                        <div className="absolute top-4 left-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm font-bold animate-pulse">
                          ✅ Target Detected
                        </div>
                      )}
                      
                      {/* Game status indicators */}
                      <div className="absolute top-4 right-4 space-y-2">
                        <div className="bg-black/80 text-white px-3 py-1 rounded-full text-sm">
                          {currentPoses.length > 0 ? '🎯 Ready to Shoot' : '🔍 Looking for Targets'}
                        </div>
                        {currentPlayer?.weapon && (
                          <div className="bg-blue-900/80 text-blue-200 px-3 py-1 rounded-full text-sm">
                            🔫 {currentPlayer.weapon.type}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Pose detection overlay */}
                    <canvas
                      ref={canvasRef}
                      className="absolute top-0 left-0 w-full h-96 pointer-events-none opacity-60"
                      style={{ mixBlendMode: 'screen' }}
                    />
                  </div>
                ) : (
                  <div className="w-full h-96 bg-gray-800 flex items-center justify-center">
                    <div className="text-center">
                      <Camera className="mx-auto mb-4 text-gray-400" size={64} />
                      <h3 className="text-white text-xl mb-2">Camera Required</h3>
                      <p className="text-gray-400 mb-4">Camera access is needed to play the game</p>
                      <button
                        onClick={async () => {
                          const hasPermission = await requestCameraPermission(showNotification);
                          setHasCameraPermission(hasPermission);
                          if (hasPermission) {
                            showNotification('Camera access granted! Game ready.', 'success');
                          } else {
                            showNotification('Camera access denied. Cannot continue game.', 'error');
                          }
                        }}
                        className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-all duration-200 font-semibold"
                      >
                        📷 Enable Camera
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Game Instructions */}
              <div className="bg-green-900/30 border border-green-600 rounded-lg p-4 mb-4">
                <h4 className="font-semibold text-green-200 mb-2">🎮 How to Play:</h4>
                <ul className="text-sm text-green-100 space-y-1">
                  <li>• <strong>Aim:</strong> Point your camera at opponents wearing different colored shirts</li>
                  <li>• <strong>Shoot:</strong> When a person appears in the crosshair, the system will auto-shoot</li>
                  <li>• <strong>Avoid:</strong> Don't let opponents point their cameras at you!</li>
                  <li>• <strong>Score:</strong> Hit opponents to gain points and reduce their health</li>
                </ul>
              </div>

              {/* Player Stats */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-gray-700/50 rounded-lg p-4">
                  <h5 className="text-gray-300 text-sm mb-2">Your Stats</h5>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Health:</span>
                      <span className={`font-bold ${
                        (currentPlayer?.health || 0) > 50 ? 'text-green-400' : 
                        (currentPlayer?.health || 0) > 20 ? 'text-yellow-400' : 'text-red-400'
                      }`}>{currentPlayer?.health || 0}/100</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Score:</span>
                      <span className="text-blue-400 font-bold">{currentPlayer?.points || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Lives:</span>
                      <span className="text-purple-400 font-bold">{currentPlayer?.lives || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Status:</span>
                      <span className={`font-bold capitalize ${
                        currentPlayer?.status === 'alive' ? 'text-green-400' : 'text-red-400'
                      }`}>{currentPlayer?.status || 'Unknown'}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-700/50 rounded-lg p-4">
                  <h5 className="text-gray-300 text-sm mb-2">Current Weapon</h5>
                  {currentPlayer?.weapon ? (
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Type:</span>
                        <span className="text-white font-bold">{currentPlayer.weapon.type}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Damage:</span>
                        <span className="text-red-400 font-bold">{currentPlayer.weapon.damage}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-gray-400 text-sm">No weapon equipped</div>
                  )}
                </div>
              </div>

              {/* Exit Game Button */}
              <div className="text-center">
                <button
                  onClick={() => setShowConfirmation(true)}
                  className="px-6 py-3 bg-red-700 text-white rounded-lg hover:bg-red-600 transition-all duration-200 font-semibold"
                >
                  🚪 Leave Game
                </button>
              </div>
            </div>
          </div>
        </>
      );
    }
    
    // Regular lobby view when not in color confirmation phase and not in progress
    
    return pageContainer(
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
                          <div className="w-8 h-8 rounded-full bg-red-800 flex items-center justify-center mr-3 relative">
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
                          <div className="w-8 h-8 rounded-full bg-blue-800 flex items-center justify-center mr-3 relative">
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
    </div>  );
};

export default Lobby;
