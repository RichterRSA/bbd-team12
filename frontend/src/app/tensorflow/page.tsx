"use client";
import "@tensorflow/tfjs-backend-webgl";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { useEffect, useRef, useState } from "react";
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




export default function TensorFlow() {
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
      const video = webcamRef.current ? webcamRef.current.video : null;
      if (!video) return;
      const poses = await model.estimatePoses(video);
      let isPersonInside = false;
      if (poses.length > 0) {
        isPersonInside = isPersonInCrosshair(poses[0], video.videoWidth, video.videoHeight, crosshairRadius);
      }
      drawCrosshair(canvasRef, webcamRef, crosshairRadius, isPersonInside, "rgba(255, 255, 255, 0.6)");
      drawDetections(poses, canvasRef, webcamRef, true, crosshairRadius);
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
    };
    const poseInterval = setInterval(detectPoseForShooting, 1000 / 60);
    return () => clearInterval(poseInterval);
  }, [model, gameState, player, hasCameraPermission]);

  if (hasCameraPermission === false) {
    return <div style={{ textAlign: 'center', padding: '20px' }}>Camera permission denied. Please allow camera access.</div>;
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
          onUserMediaError={(err) => console.error("Camera error:", err)}
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
        <div style={{ position: 'absolute', bottom: '20px', left: '20px', background: 'rgba(0,0,0,0.5)', color: 'white', padding: '5px 10px', borderRadius: '15px', fontSize: '12px' }}>
          {isDetecting ? 'MoveNet Active' : 'Initializing...'}
          {fps > 0 && ` • Camera: ${fps} FPS`}
          {detectionFps > 0 && ` • Detection: ${detectionFps} FPS`}
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