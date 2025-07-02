"use client";
import "@tensorflow/tfjs-backend-webgl";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Webcam from "react-webcam";
import { io, Socket } from "socket.io-client";
import { ready } from "@tensorflow/tfjs";
import QrScanner from "qr-scanner";
import { 
  requestCameraPermission, 
  drawDetections,
  isPersonInCrosshair,
  triggerVibration,
  drawCrosshair,
} from "../../utils/poseDetection";
import { setupQrScannerWithWebcam, createGameQrHandlers } from "../../utils/qrCodeScanning";
//import { drawCrosshair, isPersonInCrosshair, triggerVibration } from "../../utils/poseDetection";

interface Player {
  id: string;
  name: string;
  isHost: boolean;
  team: "red" | "blue";
  health: number;
  points: number;
  lives: number;
  powerUps: { type: string; active: boolean }[];
  weapon: { type: string; damage: number; cost: number } | null;
  status: "alive" | "dead";
}

interface GameState {
  id: string;
  name: string;
  players: Player[];
  status: "waiting" | "in-progress" | "finished";
  settings: { maxPlayers: number; gameMode: string };
}

// Component that uses useSearchParams - must be wrapped in Suspense
function TensorFlowContent() {
  const [model, setModel] = useState<poseDetection.PoseDetector | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [qrCodeText, setQrCodeText] = useState<string | null>(null);
  const webcamRef = useRef<Webcam | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastShotTimeRef = useRef<number>(0);
  const qrScannerRef = useRef<QrScanner | null>(null);
  const lastDetectionTimeRef = useRef<number>(0);
  const lastPosesRef = useRef<poseDetection.Pose[]>([]);
  const currentPosesRef = useRef<poseDetection.Pose[]>([]);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(0);
  const [detectionFps, setDetectionFps] = useState<number>(0);
  const frameCountRef = useRef<number>(0);
  const detectionCountRef = useRef<number>(0);
  const lastFpsUpdateRef = useRef<number>(0);
  const [vibrationStatus, setVibrationStatus] = useState<string>("");
  const [crosshairRadius, setCrosshairRadius] = useState<number>(80);
  const [videoReady, setVideoReady] = useState<boolean>(false);
  const [socketEstablished, setSocketEstablished] = useState<boolean>(false);
  const [socketAttempted, setSocketAttempted] = useState<boolean>(false);
  const reconnectionAttemptsRef = useRef<number>(0);
  const lastConnectionAttemptRef = useRef<number>(0);
  const CONNECTION_THROTTLE_MS = 5000; // Minimum 5 seconds between connection attempts

  // Get gameId and playerName from URL parameters with localStorage fallback
  const searchParams = useSearchParams();
  const gameIdParam = searchParams?.get('gameId');
  const playerNameParam = searchParams?.get('playerName');
  
  // Try to get values from URL or localStorage with proper validation
  const gameId = gameIdParam && gameIdParam !== 'null' ? gameIdParam : null;
  const playerName = playerNameParam && playerNameParam.trim() !== '' 
    ? playerNameParam 
    : (typeof window !== 'undefined' ? localStorage.getItem('playerName') : null);
  
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Initialize Socket.IO and connect to game
  useEffect(() => {
    console.log('Initializing TensorFlow game view with gameId:', gameId, 'playerName:', playerName);
    
    // Check if we have valid parameters
    if (!gameId) {
      console.error('Missing gameId in URL parameters');
      setConnectionError('Missing game ID. Please return to the lobby.');
      return;
    }
    
    if (!playerName) {
      console.error('Missing playerName in URL parameters and localStorage');
      setConnectionError('Missing player name. Please return to the lobby.');
      return;
    }
    
    // Check if this game ID has been previously marked as invalid/non-existent
    if (typeof window !== 'undefined') {
      const invalidGameId = sessionStorage.getItem('invalid_game_id');
      if (invalidGameId === gameId) {
        console.error('This game ID was previously confirmed not to exist:', gameId);
        setConnectionError('This game has ended or does not exist. Please return to the lobby to join a new game.');
        return;
      }
    }
    
    // Skip socket initialization if we already have a connection
    if (socketRef.current?.connected) {
      console.log('Socket is already connected, skipping initialization');
      return;
    }
    
    // Throttle connection attempts to prevent excessive reconnection
    const now = Date.now();
    if (now - lastConnectionAttemptRef.current < CONNECTION_THROTTLE_MS) {
      console.log(`Connection attempt throttled. Last attempt was ${now - lastConnectionAttemptRef.current}ms ago.`);
      return;
    }
    lastConnectionAttemptRef.current = now;
    
    // Initialize socket connection
    const socketUrl = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:3001' 
      : `${window.location.protocol}//${window.location.host}`;
    
    // Clear any existing socket to prevent multiple connections
    if (socketRef.current) {
      console.log('Cleaning up previous socket before creating new one');
      socketRef.current.disconnect();
      socketRef.current.removeAllListeners();
      socketRef.current = null;
    }
    
    console.log('Creating new Socket.IO connection to:', socketUrl);
    setSocketAttempted(true); // Mark that we've attempted to connect
    socketRef.current = io(socketUrl, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      path: '/socket.io/',
      autoConnect: true,
      timeout: 10000,
      transports: ['websocket', 'polling'], // Try WebSocket first, fall back to polling
    });

    // Track manual reconnection attempts with a regular variable instead of useRef
    // This is a regular variable since we're already inside a useEffect
    let reconnectionAttempts = 0;
    let gameNotFoundAttempts = 0;
    
    socketRef.current.on('connect', () => {
      console.log('Socket connected successfully with ID:', socketRef.current?.id);
      setSocketEstablished(true);
      setSocketAttempted(true);
      reconnectionAttempts = 0; // Reset reconnection attempts on successful connect
      
      // Request to join the game with both socket ID and player name for identification
      console.log('Requesting to join/rejoin game:', gameId, 'as player:', playerName);
      socketRef.current?.emit('rejoinGame', gameId, playerName);
    });

    socketRef.current.on('disconnect', () => {
      console.log('Socket disconnected');
      setSocketEstablished(false);
      // Don't reset socketAttempted - we've attempted and then disconnected
    });

    // Handle gameState events
    socketRef.current.on('gameState', (state) => {
      console.log('Received game state:', state);
      if (state && state.id === gameId) {
        setGameState(state);
        gameNotFoundAttempts = 0; // Reset attempts counter on successful state retrieval
        setConnectionError(''); // Clear any connection errors
      }
    });
    
    // Handle gameNotFound events
    socketRef.current.on('gameNotFound', () => {
      gameNotFoundAttempts++;
      console.error(`Game not found (attempt ${gameNotFoundAttempts}):`, gameId);
      
      if (gameNotFoundAttempts >= 3) {
        console.error('Maximum game not found attempts reached');
        // Mark this game ID as invalid in session storage to prevent future attempts
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('invalid_game_id', gameId);
        }
        setConnectionError('This game does not exist or has ended. Please return to the lobby.');
      } else {
        console.log('Retrying game join in 2 seconds...');
        setTimeout(() => {
          if (socketRef.current?.connected) {
            console.log('Retrying join for game:', gameId);
            socketRef.current.emit('rejoinGame', gameId, playerName);
          }
        }, 2000);
      }
    });
    
    // Handle gameConfirmedNonexistent - new event from backend for definitive game not found
    socketRef.current.on('gameConfirmedNonexistent', () => {
      console.error('Game confirmed non-existent by server:', gameId);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('invalid_game_id', gameId);
      }
      setConnectionError('This game has been confirmed not to exist. Please return to the lobby.');
    });
    
    // Handle player join confirmation
    socketRef.current.on('playerJoined', (joinedGameId, joinedPlayerName) => {
      console.log(`Player ${joinedPlayerName} joined game ${joinedGameId}`);
      if (joinedGameId === gameId && joinedPlayerName === playerName) {
        setConnectionError(''); // Clear any connection errors
        console.log('Successfully joined game');
      }
    });
    
    // Request game state when connected
    if (socketRef.current.connected) {
      console.log('Socket already connected, requesting game state directly');
      socketRef.current.emit('requestGameState', gameId);
    }
    
    // Cleanup function to prevent memory leaks
    return () => {
      console.log('Cleaning up socket connection');
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current.removeAllListeners();
        socketRef.current = null;
      }
    };
  }, [gameId, playerName]); // Only re-run if gameId or playerName changes

  // Initialize TensorFlow model and camera
  useEffect(() => {
    const initModel = async () => {
      try {
        await ready();
        console.log("Loading TensorFlow pose detection model...");
        const detector = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          {
            modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
            enableSmoothing: false,
            minPoseScore: 0.1,
            enableTracking: false,
          }
        );
        setModel(detector);
        console.log("TensorFlow model loaded successfully");
      } catch (error) {
        console.error("Error loading TensorFlow model:", error);
      }
    };

    const checkCameraPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((track) => track.stop());
        setHasCameraPermission(true);
        console.log("Camera permission granted");
      } catch (error) {
        console.error("Camera permission denied:", error);
        setHasCameraPermission(false);
      }
    };

    initModel();
    checkCameraPermission();
  }, []);

  // Calculate crosshair radius based on camera resolution (always 480px height)
  useEffect(() => {
    const updateCrosshairSize = () => {
      // Use the camera's vertical resolution (480px) as the reference
      const cameraHeight = 480;
      // Set crosshair to be 15% of the camera's vertical resolution
      const responsiveRadius = cameraHeight * 0.15;
      setCrosshairRadius(responsiveRadius);
      console.log(`Crosshair radius set to ${responsiveRadius}px based on camera height ${cameraHeight}px`);
    };

    updateCrosshairSize();
    // No need for resize listener since camera resolution is fixed
  }, []);

  // Initialize QR Scanner when webcam is ready
  useEffect(() => {
    if (!webcamRef.current?.video || !hasCameraPermission) return;

    const qrHandlers = createGameQrHandlers(gameState, player, socketRef, setNotifications, triggerVibration);
    const throttledHandler = (result: string) => {
      setQrCodeText(result);
      qrHandlers.handleGenericScan(result);
    };

    const cleanup = setupQrScannerWithWebcam(
      webcamRef,
      {
        onScan: throttledHandler,
        maxScansPerSecond: 3,
        highlightScanRegion: false,
        highlightCodeOutline: false
      },
      hasCameraPermission,
      (scanner) => { qrScannerRef.current = scanner; }
    );

    return cleanup;
  }, [hasCameraPermission, webcamRef.current?.video, gameState, player]);

  // Ensure TensorFlow is ready
  useEffect(() => {
    async function ensureTfReady() {
      await ready();
      console.log("TensorFlow.js is ready");
    }
    ensureTfReady();
  }, []);

  // Request camera permission on component mount
  useEffect(() => {
    const checkPermission = async () => {
      const hasPermission = await requestCameraPermission();
      setHasCameraPermission(hasPermission);
    };
    checkPermission();
  }, []);

  // Separate rendering loop for high framerate drawing
  useEffect(() => {
    let renderFrameId: number | null = null;
    const renderFrame = (timestamp: number) => {
      frameCountRef.current++;
      if (timestamp - lastFpsUpdateRef.current >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (timestamp - lastFpsUpdateRef.current)));
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = timestamp;
      }
      if (currentPosesRef.current.length > 0) {
        drawDetections(currentPosesRef.current, canvasRef, webcamRef, true);
      }
      renderFrameId = requestAnimationFrame(renderFrame);
    };
    renderFrameId = requestAnimationFrame(renderFrame);
    return () => { if (renderFrameId) cancelAnimationFrame(renderFrameId); };
  }, [crosshairRadius]);

  // Set up pose detection loop
  useEffect(() => {
    let detectionIntervalId: NodeJS.Timeout | null = null;
    let detectionInProgress = false;
    const targetDetectionInterval = 1000 / 30;

    const detectPose = async () => {
      if (detectionInProgress || !model || !webcamRef.current?.video) return;
      if (webcamRef.current.video.readyState !== 4) {
        console.log("Video not ready yet");
        return;
      }
      const timestamp = performance.now();
      detectionInProgress = true;
      setIsDetecting(true);

      try {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) {
          console.error("Could not create temporary context");
          return;
        }
        tempCanvas.width = 320;
        tempCanvas.height = 240;
        tempCtx.drawImage(webcamRef.current.video, 0, 0, webcamRef.current.video.videoWidth, webcamRef.current.video.videoHeight, 0, 0, tempCanvas.width, tempCanvas.height);
        const detections = await model.estimatePoses(tempCanvas, { flipHorizontal: false, maxPoses: 1 });

        detectionCountRef.current++;
        if (timestamp - lastDetectionTimeRef.current >= 1000) {
          setDetectionFps(Math.round((detectionCountRef.current * 1000) / (timestamp - lastDetectionTimeRef.current)));
          detectionCountRef.current = 0;
          lastDetectionTimeRef.current = timestamp;
        }

        if (detections.length > 0) {
          const scaleX = webcamRef.current.video.videoWidth / tempCanvas.width;
          const scaleY = webcamRef.current.video.videoHeight / tempCanvas.height;
          detections.forEach(pose => {
            pose.keypoints.forEach(keypoint => {
              keypoint.x = keypoint.x * scaleX;
              keypoint.y = keypoint.y * scaleY;
            });
          });
          lastPosesRef.current = [...currentPosesRef.current];
          currentPosesRef.current = detections;
        }
      } catch (error) {
        console.error("Error detecting poses:", error);
      } finally {
        detectionInProgress = false;
      }
    };

    if (model) {
      detectionIntervalId = setInterval(detectPose, targetDetectionInterval);
      detectPose();
    }
    return () => { if (detectionIntervalId) clearInterval(detectionIntervalId); };
  }, [model]);

  useEffect(() => {
    async function loadModel() {
      try {
        console.log("Loading MoveNet model...");
        const modelConfig: poseDetection.MoveNetModelConfig = {
          modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
          enableSmoothing: false,
          minPoseScore: 0.1,
          enableTracking: false,
        };
        const poseModel = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, modelConfig);
        setModel(poseModel);
        console.log("MoveNet model loaded successfully");
      } catch (error) {
        console.error("Error loading MoveNet model:", error);
      }
    }
    if (model === null) loadModel();
  }, [model]);

  // Handle Socket.IO events
  useEffect(() => {
    if (!socketRef.current) return;
    socketRef.current.on("gameStateUpdate", (updatedGameState: GameState) => {
      setGameState(updatedGameState);
      const currentPlayer = updatedGameState.players.find((p) => p.id === socketRef.current?.id);
      if (currentPlayer) setPlayer(currentPlayer);
    });
    socketRef.current.on("notification", (message: string) => {
      setNotifications((prev) => [...prev, message].slice(-3));
      if (message.includes("shot") || message.includes("hit") || message.includes("eliminated")) {
        triggerVibration();
        new Audio("/sounds/laser.mp3").play().catch((e) => console.error("Sound error:", e));
      }
    });
    return () => {
      socketRef.current?.off("gameStateUpdate");
      socketRef.current?.off("notification");
    };
  }, []);

  // Handle pose detection for shooting
  useEffect(() => {
    if (!model || !webcamRef.current?.video || !canvasRef.current || !hasCameraPermission || !gameState || !player) return;
    
    const detectPoseForShooting = async () => {
      const video = webcamRef.current?.video;
      if (!video) return;
      
      // Only proceed if video is actually ready
      if (!videoReady) return;
      
      try {
        // Draw crosshair regardless of pose detection
        drawCrosshair(canvasRef, webcamRef, crosshairRadius, false, "rgba(255, 255, 255, 0.6)");
        
        const poses = await model.estimatePoses(video);
        let isPersonInside = false;
        
        if (poses.length > 0) {
          isPersonInside = isPersonInCrosshair(poses[0], video.videoWidth, video.videoHeight, crosshairRadius);
          drawDetections(poses, canvasRef, webcamRef, true, crosshairRadius);
        }
        
        // Update crosshair after detection
        drawCrosshair(canvasRef, webcamRef, crosshairRadius, isPersonInside, "rgba(255, 255, 255, 0.6)");
        
        const now = Date.now();
        if (isPersonInside && player.weapon && now - lastShotTimeRef.current > 1000 && player.status === "alive") {
          socketRef.current?.emit("shoot", {
            gameId: gameState.id,
            playerId: socketRef.current?.id,
            weapon: player.weapon,
          });
          lastShotTimeRef.current = now;
          triggerVibration();
          new Audio("/sounds/singleshot.mp3").play().catch((e) => console.error("Sound error:", e));
        }
      } catch (error) {
        console.error("Error in pose detection:", error);
      }
    };
    
    // Only start the detection interval once the video is fully loaded
    let poseInterval: NodeJS.Timeout | null = null;
    
    // Start with a more conservative rate, then increase
    const startDetection = () => {
      // Draw the crosshair immediately
      if (canvasRef.current && webcamRef.current?.video) {
        drawCrosshair(canvasRef, webcamRef, crosshairRadius, false, "rgba(255, 255, 255, 0.6)");
      }
      
      // Start with a slower rate
      poseInterval = setInterval(detectPoseForShooting, 1000 / 15);
      
      // After 3 seconds, if everything is stable, increase to desired frame rate
      setTimeout(() => {
        if (poseInterval) clearInterval(poseInterval);
        poseInterval = setInterval(detectPoseForShooting, 1000 / 30);
      }, 3000);
    };
    
    // Check video readiness immediately, and if ready start detection
    if (videoReady) {
      console.log("Video is ready on initial check");
      startDetection();
    } else {
      // If not ready, poll every 500ms until ready (with a reasonable timeout)
      let readyCheckAttempts = 0;
      const readyCheckInterval = setInterval(() => {
        readyCheckAttempts++;
        if (videoReady) {
          console.log("Video became ready after polling");
          clearInterval(readyCheckInterval);
          startDetection();
        } else if (readyCheckAttempts >= 20) { // 10 second timeout
          console.log("Timed out waiting for video to be ready");
          clearInterval(readyCheckInterval);
        }
      }, 500);
      
      // Cleanup the ready check interval when the effect unmounts
      return () => {
        clearInterval(readyCheckInterval);
        if (poseInterval) clearInterval(poseInterval);
      };
    }
    
    return () => {
      if (poseInterval) clearInterval(poseInterval);
    };
  }, [model, gameState, player, hasCameraPermission]); // Removed videoReady from dependencies to prevent loops

  // Add video readiness check function - with more detailed logging
  const checkVideoReadiness = useCallback(() => {
    const video = webcamRef.current?.video;
    if (!video) {
      console.log("Video element not available yet");
      return false;
    }
    
    // Check if video dimensions are available and video is playing
    if (video.readyState === 4 && video.videoWidth > 0 && video.videoHeight > 0 && !video.paused) {
      console.log("Video is fully ready for processing:", 
        { readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, paused: video.paused });
      // Only update the state if it's not already true
      if (!videoReady) {
        setVideoReady(true);
      }
      return true;
    } else {
      // Log what specific condition is failing
      const issues = [];
      if (video.readyState !== 4) issues.push(`readyState=${video.readyState} (needs 4)`);
      if (video.videoWidth === 0) issues.push("width=0");
      if (video.videoHeight === 0) issues.push("height=0");
      if (video.paused) issues.push("paused=true");
      
      console.log(`Video not ready yet: ${issues.join(", ")}`, 
        { readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, paused: video.paused });
      return false;
    }
  }, [videoReady]);

  // Check if video is ready for processing with enhanced checks
  useEffect(() => {
    if (!webcamRef.current?.video || videoReady) return; // Skip if already ready
    
    const video = webcamRef.current.video;
    
    // Set up more reliable video ready detection
    const checkVideoReadyState = () => {
      if (!video) return false;
      
      // Check if video is fully ready with dimensions and is actually playing
      if (video.readyState === 4 && video.videoWidth > 0 && video.videoHeight > 0 && !video.paused) {
        console.log("Video is fully ready:", {
          readyState: video.readyState,
          width: video.videoWidth, 
          height: video.videoHeight,
          currentTime: video.currentTime,
          paused: video.paused
        });
        
        setVideoReady(true);
        return true;
      }
      
      // Progressive readiness check - accept partially ready video after certain attempts
      // readyState 1 = HAVE_METADATA - we have metadata but not enough data to play
      // readyState 2 = HAVE_CURRENT_DATA - we have data for current frame only
      // readyState 3 = HAVE_FUTURE_DATA - we have data for current and next frame
      if (pollCount > 50 && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        console.log("Video is partially ready but accepting after multiple attempts:", {
          readyState: video.readyState,
          width: video.videoWidth, 
          height: video.videoHeight,
          currentTime: video.currentTime,
          paused: video.paused,
          attempts: pollCount
        });
        
        setVideoReady(true);
        return true;
      }
      
      // Log different reasons why video isn't ready for better debugging
      let notReadyReason = "";
      if (video.readyState < 4) notReadyReason += `readyState ${video.readyState} < 4; `;
      if (video.videoWidth <= 0) notReadyReason += "no width; ";
      if (video.videoHeight <= 0) notReadyReason += "no height; ";
      if (video.paused) notReadyReason += "paused; ";
      
      console.log(`Video not fully ready (${notReadyReason.trim()})`, {
        readyState: video.readyState,
        width: video.videoWidth, 
        height: video.videoHeight,
        currentTime: video.currentTime,
        paused: video.paused,
        attempt: pollCount
      });
      
      return false;
    };
    
    // Start polling for video readiness
    let pollCount = 0;
    const maxPolls = 120; // 12 seconds at 100ms intervals
    
    const pollInterval = setInterval(() => {
      pollCount++;
      
      if (checkVideoReadyState() || pollCount >= maxPolls) {
        clearInterval(pollInterval);
        
        if (pollCount >= maxPolls && !videoReady) {
          console.warn("Video readiness polling timed out after", pollCount, "attempts - falling back to progressive readiness");
          
          // Final fallback: If we have any kind of readyState and dimensions, accept the video as ready
          if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) {
            console.log("Falling back to accepting minimally ready video");
            setVideoReady(true);
          } else if (video.readyState >= 1) {
            // Try to estimate dimensions as a last resort
            console.log("Using estimated dimensions as last resort");
            // Force a minimal size to allow processing to begin
            if (!video.videoWidth) video.width = 320;
            if (!video.videoHeight) video.height = 240;
            setVideoReady(true);
          } else {
            console.error("Video completely failed to initialize after timeout");
            // We'll still set videoReady true to allow the app to proceed,
            // but with a warning in the console
            setVideoReady(true);
          }
        }
      }
    }, 100);
    
    // Also listen for standard video events as backup triggers
    const handleVideoReady = () => {
      console.log("Video loadeddata event fired");
      checkVideoReadyState();
    };
    
    video.addEventListener('loadeddata', handleVideoReady);
    video.addEventListener('loadedmetadata', () => console.log("Video loadedmetadata event"));
    video.addEventListener('playing', () => {
      console.log("Video playing event");
      // Additional check when playing event fires
      setTimeout(checkVideoReadyState, 500);
    });
    
    // Play the video with a user gesture simulation
    const attemptVideoPlay = () => {
      if (video.paused) {
        console.log("Attempting to autoplay video");
        video.muted = true; // Mute to allow autoplay
        video.play().catch(err => console.error("Error autoplaying video:", err));
      }
    };
    
    // Try to play video after a short delay to ensure DOM is ready
    setTimeout(attemptVideoPlay, 1000);
    
    // Try again after a longer delay as a fallback
    setTimeout(() => {
      if (!videoReady && video) {
        console.log("Retry video play after delay");
        attemptVideoPlay();
        // Check readiness after a moment
        setTimeout(checkVideoReadyState, 500);
      }
    }, 3000);
    
    return () => {
      clearInterval(pollInterval);
      video.removeEventListener('loadeddata', handleVideoReady);
      video.removeEventListener('loadedmetadata', () => {});
      video.removeEventListener('playing', () => {});
    };
  }, [hasCameraPermission, videoReady]); // Changed dependency to prevent constant re-runs

  // Enhanced WebcamWithRetry component that handles failures and retries
  const WebcamWithRetry = ({ onUserMedia, onError }: { onUserMedia: (stream: MediaStream) => void, onError: (err: string | DOMException) => void }) => {
    const [retryCount, setRetryCount] = useState(0);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const maxRetries = 3;

    // Progressive video constraints with different fallback options
    const videoConstraintsOptions = [
      // First attempt - optimal quality with environment camera on mobile
      {
        width: { ideal: 640 },
        height: { ideal: 480 },
        aspectRatio: 4/3,
        facingMode: typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) 
          ? { ideal: "environment" } 
          : { ideal: "user" }
      },
      // Second attempt - try without facingMode constraint
      {
        width: { ideal: 640 },
        height: { ideal: 480 },
        aspectRatio: 4/3
      },
      // Third attempt - most basic constraints
      {
        width: { min: 320 },
        height: { min: 240 },
      },
      // Final attempt - any video source
      true
    ];

    // Get the current constraint set based on retry count
    const currentConstraints = videoConstraintsOptions[Math.min(retryCount, videoConstraintsOptions.length - 1)];
    
    // Handle error and retry if possible
    const handleWebcamError = (err: string | DOMException) => {
      console.error(`Webcam error (attempt ${retryCount + 1}/${maxRetries + 1}):`, err);
      
      if (retryCount < maxRetries) {
        console.log(`Retrying with fallback constraints: ${JSON.stringify(currentConstraints)}`);
        setCameraError(`Camera error, retrying with different settings (${retryCount + 1}/${maxRetries})...`);
        setRetryCount(prev => prev + 1);
      } else {
        console.error("All webcam attempts failed");
        setCameraError("Unable to access camera after multiple attempts. Please check permissions and try again.");
        onError(err);
      }
    };
    
    return (
      <div className="relative w-full h-full">
        <Webcam
          ref={webcamRef}
          audio={false}
          videoConstraints={currentConstraints}
          onUserMedia={onUserMedia}
          onUserMediaError={handleWebcamError}
          mirrored={typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? false : true}
          className="absolute inset-0 w-full h-full object-cover"
          width={640}
          height={480}
          screenshotFormat="image/jpeg"
        />
        {cameraError && (
          <div className="absolute bottom-0 left-0 right-0 bg-red-600 text-white p-2 text-center text-sm">
            {cameraError}
          </div>
        )}
      </div>
    );
  };

  // UI Component for connection status
  const ConnectionStatusDisplay = () => {
    if (!socketEstablished) {
      return (
        <div className="fixed top-0 left-0 right-0 bg-blue-600 text-white p-2 text-center z-50">
          Establishing connection to game server...
        </div>
      );
    }
    
    if (connectionError) {
      return (
        <div className="fixed top-0 left-0 right-0 bg-red-600 text-white p-2 text-center z-50">
          {connectionError}
        </div>
      );
    }
    
    if (socketEstablished && !videoReady) {
      return (
        <div className="fixed top-0 left-0 right-0 bg-yellow-600 text-white p-2 text-center z-50">
          Connected to server. Setting up camera...
        </div>
      );
    }
    
    if (socketEstablished && videoReady && gameState) {
      return (
        <div className="fixed top-0 left-0 right-0 bg-green-600 text-white p-2 text-center z-50">
          Connected to game: {gameState.name} (#{gameId})
        </div>
      );
    }
    
    return null;
  };
  
  // Enhanced error display with retry and return options
  const ErrorDisplay = () => {
    if (!connectionError) return null;
    
    // If error indicates definitive game non-existence, offer only return option
    const isGameNonExistent = connectionError.includes('does not exist') || 
                              connectionError.includes('has ended') ||
                              connectionError.includes('confirmed not to exist');
    
    // If connection error is definitive (max attempts reached), show clear message
    const isConnectionFailure = connectionError.includes('after multiple attempts') ||
                                connectionError.includes('Maximum reconnection attempts');
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
        <div className="bg-white p-6 rounded-lg max-w-md w-full">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Connection Error</h2>
          <p className="mb-6">{connectionError}</p>
          
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {!isGameNonExistent && (
              <button 
                onClick={() => {
                  // Clear error and attempt to reconnect
                  setConnectionError('');
                  if (socketRef.current) {
                    socketRef.current.disconnect();
                    socketRef.current.removeAllListeners();
                    socketRef.current = null;
                  }
                  lastConnectionAttemptRef.current = 0; // Reset throttling
                  window.location.reload(); // Force full page refresh for clean reconnect
                }}
                className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
              >
                Try Again
              </button>
            )}
            
            <button 
              onClick={() => {
                // Return to lobby
                window.location.href = '/lobby';
              }}
              className="bg-gray-600 text-white py-2 px-4 rounded hover:bg-gray-700"
            >
              Return to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (hasCameraPermission === false) {
    return <div style={{ textAlign: 'center', padding: '20px' }}>Camera permission denied. Please allow camera access.</div>;
  }

  // If we don't have gameId, we can't do anything useful
  if (!gameId) {
    return (
      <div style={{ minHeight: '100vh', background: 'black', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: 'yellow', marginBottom: '16px' }}>Missing Game ID</h1>
          <p style={{ fontSize: '18px', marginBottom: '20px' }}>Game ID is missing. Please start the game from the lobby.</p>
          <button 
            onClick={() => window.location.href = '/'}
            style={{ 
              padding: '10px 20px', 
              fontSize: '16px', 
              backgroundColor: '#4CAF50', 
              color: 'white', 
              border: 'none', 
              borderRadius: '5px', 
              cursor: 'pointer' 
            }}
          >
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }
  
  // If we don't have playerName, try to get it from localStorage as a fallback
  const effectivePlayerName = playerName || localStorage.getItem('lastPlayerName') || "Unknown Player";

  // Display connection error if we have one
  if (connectionError) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: '#333', 
        color: 'white', 
        display: 'flex', 
        flexDirection: 'column',
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: '20px' 
      }}>
        <div style={{ 
          textAlign: 'center',
          maxWidth: '600px',
          padding: '30px',
          borderRadius: '10px',
          background: '#222',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#ff4040', marginBottom: '16px' }}>
            Connection Error
          </h1>
          <p style={{ fontSize: '16px', marginBottom: '20px', lineHeight: '1.5' }}>
            {connectionError}
          </p>
          <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
            <button 
              onClick={() => window.location.reload()} 
              style={{ 
                padding: '10px 20px',
                fontSize: '16px',
                background: '#3d8e33',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
            >
              Try Again
            </button>
            <button 
              onClick={() => window.location.href = '/lobby'} 
              style={{ 
                padding: '10px 20px',
                fontSize: '16px',
                background: '#3366ff',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
            >
              Return to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (player && player.status === "dead") {
    return (
      <div style={{ minHeight: '100vh', background: 'black', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: 'red', marginBottom: '16px' }}>Game Over</h1>
          <p style={{ fontSize: '18px' }}>You have been eliminated. Check the scores at /scores.</p>
          {qrCodeText && <div style={{ fontSize: '24px', color: 'green', marginTop: '16px' }}>{qrCodeText}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      position: 'fixed', 
      top: 0, 
      left: 0, 
      right: 0, 
      bottom: 0, 
      width: '100%', 
      height: '100%', 
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {/* Connection Status Bar at the top */}
      <ConnectionStatusDisplay />
      
      {/* Error Display Modal */}
      {connectionError && <ErrorDisplay />}
      
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <Webcam
          audio={false}
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'cover',
            position: 'absolute',
            top: 0,
            left: 0
          }}
          videoConstraints={{
            facingMode: "environment",
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 480 },
            frameRate: { ideal: 30, min: 30 },
          }}
          mirrored={false}
          onUserMedia={() => console.log("Camera accessed successfully at high framerate")}
          onUserMediaError={(err) => {
            console.error("Camera error:", err);
            setConnectionError(`Camera access error: ${err instanceof DOMException ? err.name : 'Unknown'}. ${err instanceof DOMException ? err.message : 'Please check camera permissions and try again.'}`);
          }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        />
        {qrCodeText && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0, 255, 0, 0.9)',
            color: 'black',
            padding: '10px 15px',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 'bold',
            zIndex: 20,
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)'
          }}>
            📱 QR: {qrCodeText}
          </div>
        )}
        
        {/* Status Indicators */}
        <div style={{ 
          position: 'absolute', 
          bottom: '20px', 
          left: '20px', 
          background: 'rgba(0,0,0,0.5)', 
          color: 'white', 
          padding: '5px 10px', 
          borderRadius: '15px', 
          fontSize: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}>
          <div>
            {isDetecting ? '✅ MoveNet Active' : '⏳ Initializing...'}
            {fps > 0 && ` • Camera: ${fps} FPS`}
            {detectionFps > 0 && ` • Detection: ${detectionFps} FPS`}
          </div>
          <div>
            {!socketAttempted ? '⏳ Connecting...' : socketEstablished ? '✅ Server Connected' : '❌ Server Disconnected'}
            {videoReady ? ' • ✅ Camera Ready' : ' • ⏳ Camera Loading...'}
          </div>
        </div>

        {/* Notifications Panel */}
        <div style={{
          position: 'absolute',
          right: '20px',
          top: '25%',
          width: '20%',
          maxWidth: '200px',
          padding: '10px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          borderRadius: '8px',
          zIndex: 10
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '300', marginBottom: '8px' }}>Notifications</h3>
          {notifications.map((note, index) => (
            <div key={index} style={{ fontSize: '14px', color: '#d3d3d3', marginBottom: '4px' }}>{note}</div>
          ))}
        </div>

        {/* Transparent Button (80% of bottom half) */}
        <button
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '10%',
            width: '80%',
            height: '35%',
            background: 'transparent',
            border: '2px solid black',
            borderRadius: '10px',
            opacity: 0.5,
            transition: 'opacity 0.2s',
            zIndex: 10,
          }}
          onClick={() => console.log("Button clicked")}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.75'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; }}
        ></button>
      </div>
    </div>
  );
}

// Loading component to show while Suspense is waiting
function TensorFlowLoading() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ 
          fontSize: '24px', 
          marginBottom: '20px',
          animation: 'pulse 2s infinite'
        }}>
          Loading Game...
        </div>
        <div style={{ 
          width: '40px', 
          height: '40px', 
          border: '4px solid rgba(255, 255, 255, 0.3)',
          borderTop: '4px solid white',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto'
        }}></div>
      </div>
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

// Main component that wraps TensorFlowContent in Suspense
export default function TensorFlow() {
  return (
    <Suspense fallback={<TensorFlowLoading />}>
      <TensorFlowContent />
    </Suspense>
  );
}