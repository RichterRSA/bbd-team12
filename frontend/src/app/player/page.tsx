
"use client";

import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { io, Socket } from "socket.io-client";
import QrScanner from "qr-scanner";
import { drawDetections } from "@/utils/poseDetection";
import { setupQrScannerWithWebcam, createThrottledQrHandler, createGameQrHandlers } from "@/utils/qrCodeScanning";
import { isPersonInCrosshair, drawCrosshair } from "@/utils/crosshairUtils";
import { triggerVibration } from "@/utils/deviceUtils";

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

const CROSSHAIR_RADIUS = 60; // Reduced from 80 for easier, more forgiving targeting

export default function PlayerView() {
  const [model, setModel] = useState<poseDetection.PoseDetector | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [screenFlash, setScreenFlash] = useState<'none' | 'damage' | 'shoot'>('none');
  const [showDeathOverlay, setShowDeathOverlay] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [qrCodeText, setQrCodeText] = useState<string | null>(null);
  const webcamRef = useRef<Webcam | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastShotTimeRef = useRef<number>(0);
  const qrScannerRef = useRef<QrScanner | null>(null);

  // Initialize Socket.IO and TensorFlow model
  useEffect(() => {
    socketRef.current = io("http://localhost:3001", { transports: ["websocket"] });

    const initModel = async () => {
      await import("@tensorflow/tfjs-backend-webgl");
      const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet);
      setModel(detector);
    };

    const checkCameraPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((track) => track.stop());
        setHasCameraPermission(true);
      } catch (error) {
        console.error("Camera permission denied:", error);
        setHasCameraPermission(false);
      }
    };

    initModel();
    checkCameraPermission();

    return () => {
      socketRef.current?.disconnect();
      model?.dispose();
      qrScannerRef.current?.destroy();
    };
  }, []);

  // Start camera streaming when game starts
  useEffect(() => {
    if (gameState && gameState.status === 'in-progress' && socketRef.current && webcamRef.current?.video) {
      console.log('🎥 Starting camera stream for spectators');
      socketRef.current.emit('startCameraStream', { 
        gameId: gameState.id, 
        type: 'environment' 
      });

      return () => {
        if (socketRef.current) {
          socketRef.current.emit('stopCameraStream', { 
            gameId: gameState.id, 
            type: 'environment' 
          });
        }
      };
    }
  }, [gameState?.status, gameState?.id]);

  // Send camera frames to spectators
  useEffect(() => {
    if (!webcamRef.current?.video || !gameState || gameState.status !== 'in-progress') return;

    const sendCameraFrames = () => {
      const video = webcamRef.current?.video;
      if (!video || !socketRef.current) return;

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);

      try {
        const frame = canvas.toDataURL('image/jpeg', 0.5); // Lower quality for streaming
        socketRef.current.emit('cameraFrame', {
          gameId: gameState.id,
          frame: frame
        });
      } catch (error) {
        console.error('Error sending camera frame:', error);
      }
    };

    const interval = setInterval(sendCameraFrames, 200); // Send 5 FPS to spectators

    return () => {
      clearInterval(interval);
    };
  }, [gameState?.status, gameState?.id, webcamRef.current?.video]);

  // Initialize QR Scanner when webcam is ready
  useEffect(() => {
    if (!webcamRef.current?.video || !hasCameraPermission) return;

    const qrHandlers = createGameQrHandlers(
      gameState,
      player,
      socketRef,
      setNotifications,
      triggerVibration
    );

    const throttledHandler = createThrottledQrHandler(qrHandlers.handleGenericScan, 2000);

    const cleanup = setupQrScannerWithWebcam(
      webcamRef,
      {
        onScan: (result) => {
          setQrCodeText(result);
          throttledHandler(result);
        },
        maxScansPerSecond: 5,
        highlightScanRegion: false,
        highlightCodeOutline: false
      },
      hasCameraPermission,
      (scanner) => {
        qrScannerRef.current = scanner;
      }
    );

    return cleanup;
  }, [hasCameraPermission, webcamRef.current?.video, gameState, player]);

  // Handle Socket.IO events
  useEffect(() => {
    if (!socketRef.current) return;

    socketRef.current.on("gameStateUpdate", (updatedGameState: GameState) => {
      setGameState(updatedGameState);
      const currentPlayer = updatedGameState.players.find((p) => p.id === socketRef.current?.id);
      if (currentPlayer) {
        // Check if health decreased (took damage)
        if (player && currentPlayer.health < player.health) {
          try {
            const audio = new Audio("/sounds/lasershot.wav");
            audio.volume = 0.8;
            audio.play().catch((e) => console.error("Damage sound error:", e));
          } catch (error) {
            console.error("Error creating damage sound:", error);
          }
          
          setScreenFlash('damage');
          setTimeout(() => setScreenFlash('none'), 500);
          triggerVibration();
          
          setNotifications((prev) => [...prev, `💥 Took ${player.health - currentPlayer.health} damage!`].slice(-3));
        }
        
        // Check if player just died (health reached 0)
        if (player && player.health > 0 && currentPlayer.health === 0) {
          setScreenFlash('damage');
          setTimeout(() => setScreenFlash('none'), 1000);
          setShowDeathOverlay(true);
          
          // Hide overlay after 3 seconds
          setTimeout(() => setShowDeathOverlay(false), 3000);
          
          // Death vibration
          if (navigator.vibrate) {
            navigator.vibrate([500, 200, 500, 200, 500]);
          }
          
          setNotifications((prev) => [...prev, `💀 YOU HAVE BEEN ELIMINATED!`].slice(-3));
        }
        
        setPlayer(currentPlayer);
      }
    });

    socketRef.current.on("notification", (message: string) => {
      setNotifications((prev) => [...prev, message].slice(-3));
      if (message.includes("shot") || message.includes("hit") || message.includes("eliminated")) {
        triggerVibration();
        new Audio("/sounds/singleshot.mp3").play().catch((e) => console.error("Sound error:", e));
      }
    });

    // Listen for player elimination
    socketRef.current.on("playerEliminated", (data: { playerId: string; playerName: string; eliminatedBy?: string }) => {
      if (data.playerId === socketRef.current?.id) {
        // This player has been eliminated
        setScreenFlash('damage');
        setTimeout(() => setScreenFlash('none'), 1000);
        setShowDeathOverlay(true);
        
        // Hide overlay after 3 seconds
        setTimeout(() => setShowDeathOverlay(false), 3000);
        
        // Strong vibration pattern for death
        if (navigator.vibrate) {
          navigator.vibrate([500, 200, 500, 200, 500]);
        }
        
        // Play death sound
        try {
          const audio = new Audio("/sounds/lasershot.wav");
          audio.volume = 1.0;
          audio.play().catch((e) => console.error("Death sound error:", e));
        } catch (error) {
          console.error("Error creating death sound:", error);
        }
        
        const eliminator = data.eliminatedBy ? ` by ${data.eliminatedBy}` : '';
        setNotifications((prev) => [...prev, `💀 YOU HAVE BEEN ELIMINATED${eliminator}!`].slice(-3));
        
        // Force update player status
        if (player) {
          setPlayer({...player, status: 'dead', health: 0});
        }
      } else {
        // Another player was eliminated
        const eliminator = data.eliminatedBy ? ` by ${data.eliminatedBy}` : '';
        setNotifications((prev) => [...prev, `💀 ${data.playerName} eliminated${eliminator}`].slice(-3));
      }
    });

    return () => {
      socketRef.current?.off("gameStateUpdate");
      socketRef.current?.off("notification");
      socketRef.current?.off("playerEliminated");
    };
  }, []);

  // Handle pose detection
  useEffect(() => {
    if (!model || !webcamRef.current?.video || !canvasRef.current || !hasCameraPermission || !gameState || !player) return;

    const detectPoses = async () => {
      const video = webcamRef.current?.video;
      if (!video) return;

      const poses = await model.estimatePoses(video);
      let isPersonInside = false;

      if (poses.length > 0) {
        isPersonInside = isPersonInCrosshair(poses[0], video.videoWidth, video.videoHeight, CROSSHAIR_RADIUS);
      }

      drawCrosshair(canvasRef, webcamRef, CROSSHAIR_RADIUS, isPersonInside, "rgba(255, 255, 255, 0.6)");
      drawDetections(poses, canvasRef, webcamRef, true);

      // Send camera frame to spectators (reduced frequency)
      if (socketRef.current && gameState.status === 'in-progress') {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0);
          const frame = canvas.toDataURL('image/jpeg', 0.3); // Low quality for streaming
          socketRef.current.emit('cameraFrame', {
            gameId: gameState.id,
            frame: frame
          });
        }
      }

      const now = Date.now();
      if (isPersonInside && player.weapon && now - lastShotTimeRef.current > 1000) {
        socketRef.current?.emit("shoot", {
          gameId: gameState.id,
          playerId: socketRef.current?.id,
          weapon: player.weapon,
        });
        lastShotTimeRef.current = now;
        
        // Enhanced shooting effects
        setScreenFlash('shoot');
        setTimeout(() => setScreenFlash('none'), 200);
        triggerVibration();
        
        try {
          const audio = new Audio("/sounds/singleshot.mp3");
          audio.volume = 0.7;
          audio.play().catch((e) => console.error("Sound error:", e));
        } catch (error) {
          console.error("Error creating shoot sound:", error);
        }
        
        setNotifications((prev) => [...prev, "🎯 Shot fired!"].slice(-3));
      }
    };

    const poseInterval = setInterval(detectPoses, 1000 / 60); // 60 FPS for pose detection
    
    return () => {
      clearInterval(poseInterval);
    };
  }, [model, gameState, player, hasCameraPermission]);

  // Handle purchasing weapons and lives
  const handlePurchase = (item: "weapon" | "life", type?: string) => {
    if (!socketRef.current || !gameState || !player || player.status === "dead") {
      if (player && player.status === "dead") {
        setNotifications((prev) => [...prev, "Cannot purchase: You are dead"].slice(-3));
      }
      return;
    }

    const weapons = [
      { type: "Pistol", damage: 10, cost: 50 },
      { type: "Rifle", damage: 20, cost: 100 },
      { type: "Sniper", damage: 50, cost: 200 },
    ];

    if (item === "weapon" && type) {
      const weapon = weapons.find((w) => w.type === type);
      if (weapon && player.points >= weapon.cost) {
        socketRef.current.emit("purchaseWeapon", { gameId: gameState.id, playerId: player.id, weapon });
        new Audio("/sounds/reload.wav").play().catch((e) => console.error("Purchase sound error:", e));
        setNotifications((prev) => [...prev, `Purchased ${weapon.type}!`].slice(-3));
      } else {
        setNotifications((prev) => [...prev, "Insufficient points for weapon"].slice(-3));
      }
    } else if (item === "life" && player.points >= 100) {
      socketRef.current.emit("purchaseLife", { gameId: gameState.id, playerId: player.id });
      new Audio("/sounds/powerup.wav").play().catch((e) => console.error("Purchase sound error:", e));
      setNotifications((prev) => [...prev, "Extra life purchased!"].slice(-3));
    } else {
      setNotifications((prev) => [...prev, "Insufficient points for life"].slice(-3));
    }
  };

  // Handle activating power-up
  const handleActivatePowerUp = (type: string) => {
    if (!socketRef.current || !gameState || !player || player.status === "dead") {
      if (player && player.status === "dead") {
        setNotifications((prev) => [...prev, "Cannot activate power-up: You are dead"].slice(-3));
      }
      return;
    }
    socketRef.current.emit("activatePowerUp", { gameId: gameState.id, playerId: player.id, powerUpType: type });
  };

  if (hasCameraPermission === false) {
    return <div className="text-white text-center p-4">Camera permission denied. Please enable camera access.</div>;
  }

  if (player && player.status === "dead") {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 relative overflow-hidden">
        {/* Dramatic red overlay */}
        <div className="absolute inset-0 bg-red-900/30 animate-pulse"></div>
        
        {/* Death screen content */}
        <div className="text-center z-10 max-w-md">
          <h1 className="text-6xl font-bold text-red-500 mb-6 animate-bounce">💀</h1>
          <h2 className="text-4xl font-bold text-red-400 mb-4 animate-pulse">ELIMINATED!</h2>
          <p className="text-xl mb-6">You have been taken out of the game.</p>
          
          {player.health === 0 && (
            <div className="bg-red-900/50 rounded-lg p-4 mb-6">
              <p className="text-lg">Final Stats:</p>
              <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
                <div>Health: <span className="text-red-400">0 HP</span></div>
                <div>Points: <span className="text-yellow-400">{player.points}</span></div>
                <div>Team: <span className={player.team === 'red' ? 'text-red-400' : 'text-blue-400'}>{player.team}</span></div>
                <div>Lives: <span className="text-orange-400">{player.lives}</span></div>
              </div>
            </div>
          )}
          
          <p className="text-lg text-gray-300">Watch the game continue or check the spectator view.</p>
          
          {qrCodeText && (
            <div className="text-2xl text-green-500 mt-6 bg-black/50 px-4 py-2 rounded">
              QR: {qrCodeText}
            </div>
          )}
          
          {/* Last notifications */}
          {notifications.length > 0 && (
            <div className="mt-6 bg-black/50 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-2">Recent Events:</h3>
              {notifications.slice(-3).map((note, index) => (
                <div key={index} className="text-sm text-gray-300 mb-1">
                  {note}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Webcam and Canvas Overlay */}
      <div className="relative w-full h-screen">
        <Webcam
          audio={false}
          ref={webcamRef}
          className="absolute top-0 left-0 w-full h-full object-cover"
          screenshotFormat="image/jpeg"
          videoConstraints={{
            facingMode: "environment"
          }}
        />
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
        
        {/* Screen Flash Overlay */}
        <div className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
          screenFlash === 'damage' ? 'bg-red-500/50 opacity-100' :
          screenFlash === 'shoot' ? 'bg-yellow-500/30 opacity-100' :
          'opacity-0'
        }`} />
        
        {/* QR Code Text Overlay */}
        {qrCodeText && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-2xl text-green-500 bg-black/50 px-4 py-2 rounded pointer-events-none">
            {qrCodeText}
          </div>
        )}
      </div>

      {/* Immediate Death Notification Overlay */}
      {showDeathOverlay && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 animate-fade-in">
          <div className="text-center">
            <h1 className="text-8xl animate-bounce mb-4">💀</h1>
            <h2 className="text-4xl font-bold text-red-500 mb-4 animate-pulse">ELIMINATED!</h2>
            <p className="text-xl text-white">You have been eliminated from the game.</p>
            <div className="mt-4 text-lg text-gray-300">
              Switching to death screen...
            </div>
          </div>
        </div>
      )}

      {/* Player Interface Overlay */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top: Game Status and Player Stats */}
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-light">
                {gameState?.name || "Loading..."} - {gameState?.status || "Waiting"}
              </h2>
              {player && (
                <div className="flex items-center space-x-2">
                  <span className={`w-3 h-3 rounded-full ${player.team === "red" ? "bg-red-500" : "bg-blue-500"}`} />
                  <span>{player.team.charAt(0).toUpperCase() + player.team.slice(1)} Team</span>
                </div>
              )}
            </div>
            {player && (
              <div className="text-right">
                <div>Health: {player.health} HP</div>
                <div>Points: {player.points}</div>
                <div>Lives: {player.lives}</div>
                <div>Weapon: {player.weapon?.type || "None"}</div>
                <div>Status: {player.status.charAt(0).toUpperCase() + player.status.slice(1)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom: Action Buttons and Power-Ups */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent pointer-events-auto">
          <div className="flex justify-between items-center">
            <div className="flex space-x-2">
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded pointer-events-auto"
                onClick={() => handlePurchase("weapon", "Pistol")}
              >
                Pistol (50)
              </button>
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded pointer-events-auto"
                onClick={() => handlePurchase("weapon", "Rifle")}
              >
                Rifle (100)
              </button>
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded pointer-events-auto"
                onClick={() => handlePurchase("weapon", "Sniper")}
              >
                Sniper (200)
              </button>
              <button
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded pointer-events-auto"
                onClick={() => handlePurchase("life")}
              >
                Extra Life (100)
              </button>
            </div>
            <div className="flex space-x-2">
              {player?.powerUps?.map((powerUp, index) => (
                <button
                  key={index}
                  className={`px-3 py-1 rounded text-sm pointer-events-auto ${
                    powerUp.active ? "bg-purple-600" : "bg-purple-400"
                  }`}
                  onClick={() => handleActivatePowerUp(powerUp.type)}
                >
                  {powerUp.type}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Notifications */}
        <div className="absolute right-0 top-1/4 p-4 w-64 bg-black/70 rounded-l-lg pointer-events-auto">
          <h3 className="text-lg font-light mb-2">Notifications</h3>
          {notifications.map((note, index) => (
            <div key={index} className="text-sm text-gray-300 mb-1">
              {note}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
