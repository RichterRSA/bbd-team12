
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

// Function to trigger phone vibration
const triggerVibration = () => {
    if (navigator.vibrate) {
        // Vibrate for 200ms
        navigator.vibrate(200);
        console.log("Phone vibration triggered");
    } else {
        console.log("Vibration API not supported on this device");
        // Fallback: show visual feedback
        return false;
    }
    return true;
};

// Function to check if person is inside the crosshair circle
const isPersonInCrosshair = (
    pose: poseDetection.Pose,
    videoWidth: number,
    videoHeight: number,
    crosshairRadius: number,
    confidenceThreshold: number = 0.3
): boolean => {
    if (!pose.keypoints || pose.keypoints.length === 0) {
        return false;
    }

    // Get key body points for center calculation
    const coreKeypoints = pose.keypoints.filter(keypoint => 
        keypoint.name && 
        ['nose', 'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'].includes(keypoint.name) &&
        keypoint.score && 
        keypoint.score > confidenceThreshold
    );

    if (coreKeypoints.length < 3) {
        return false;
    }

    // Calculate the center of the person
    const avgX = coreKeypoints.reduce((sum, kp) => sum + kp.x, 0) / coreKeypoints.length;
    const avgY = coreKeypoints.reduce((sum, kp) => sum + kp.y, 0) / coreKeypoints.length;

    // Calculate frame center
    const frameCenterX = videoWidth / 2;
    const frameCenterY = videoHeight / 2;

    // Calculate distance from person center to frame center
    const distance = Math.sqrt(
        Math.pow(avgX - frameCenterX, 2) + Math.pow(avgY - frameCenterY, 2)
    );

    // Check if person is within the crosshair circle
    return distance <= crosshairRadius;
};


// Function to check if a person is inside the crosshair
const drawCrosshair = (
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    webcamRef: React.RefObject<Webcam | null>,
    crosshairRadius: number,
    isPersonInside: boolean = false
) => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = webcamRef.current?.video;

    if (!ctx || !video) {
        return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get scaling factors
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;
    const scaleX = displayWidth / videoWidth;
    const scaleY = displayHeight / videoHeight;

    // Calculate center of the display
    const centerX = displayWidth / 2;
    const centerY = displayHeight / 2;

    // Scale the radius to match display coordinates
    const scaledRadius = crosshairRadius * Math.min(scaleX, scaleY);

    // Draw outer circle
    ctx.strokeStyle = isPersonInside ? "rgba(0, 255, 0, 0.8)" : "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, scaledRadius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw inner circle (smaller)
    ctx.strokeStyle = isPersonInside ? "rgba(0, 255, 0, 0.6)" : "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, scaledRadius * 0.7, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw crosshair lines
    ctx.strokeStyle = isPersonInside ? "rgba(0, 255, 0, 0.7)" : "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 2;
    
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(centerX - scaledRadius * 0.3, centerY);
    ctx.lineTo(centerX + scaledRadius * 0.3, centerY);
    ctx.stroke();
    
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - scaledRadius * 0.3);
    ctx.lineTo(centerX, centerY + scaledRadius * 0.3);
    ctx.stroke();

    // Draw center dot
    ctx.fillStyle = isPersonInside ? "rgba(0, 255, 0, 0.9)" : "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, 2 * Math.PI);
    ctx.fill();
};


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
      drawCrosshair(canvasRef, webcamRef, crosshairRadius, isPersonInside);
      drawDetections(poses, canvasRef, webcamRef, true);
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
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'stretch', padding: '10px' }}>
      <div style={{ position: 'relative', flex: 1, minHeight: '0' }}>
        <Webcam
          audio={false}
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' }}
          videoConstraints={{
            facingMode: "environment",
            width: 320,
            height: 480,
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
        <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.5)', color: 'white', padding: '5px 10px', borderRadius: '15px', fontSize: '12px' }}>
          {isDetecting ? 'MoveNet Active' : 'Initializing...'}
          {fps > 0 && ` • Camera: ${fps} FPS`}
          {detectionFps > 0 && ` • Detection: ${detectionFps} FPS`}
        </div>

        {/* Notifications Panel */}
        <div style={{
          position: 'absolute',
          right: '10px',
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
            bottom: 0,
            left: '10%',
            width: '80%',
            height: '40vh',
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