
"use client";

import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { io, Socket } from "socket.io-client";
import { drawCrosshair, drawDetections, isPersonInCrosshair, triggerVibration } from "../tensorflow/page";
import QrScanner from "qr-scanner";

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

const CROSSHAIR_RADIUS = 80;

export default function PlayerView() {
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
  const lastItemScanTimeRef = useRef<number>(0);
  const qrScannerRef = useRef<QrScanner | null>(null);

  // Initialize Socket.IO, TensorFlow model, and QR Scanner
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

    const initQrScanner = () => {
      const video = webcamRef.current?.video;
      if (video) {
        qrScannerRef.current = new QrScanner(video, (result) => {
          // Handled in detectQRCode
        }, {
          returnDetailedScanResult: true,
          highlightScanRegion: false,
          highlightCodeOutline: false,
          maxScansPerSecond: 5
        });
      }
    };

    initModel();
    checkCameraPermission();
    initQrScanner();

    return () => {
      socketRef.current?.disconnect();
      model?.dispose();
      qrScannerRef.current?.destroy();
    };
  }, []);

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

  // Handle pose detection and QR code scanning
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

      drawCrosshair(canvasRef, webcamRef, CROSSHAIR_RADIUS, isPersonInside);
      drawDetections(poses, canvasRef, webcamRef, true);

      const now = Date.now();
      if (isPersonInside && player.weapon && now - lastShotTimeRef.current > 1000) {
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

    const detectQRCode = async () => {
      if (!qrScannerRef.current) return;

      try {
        const result = await QrScanner.scanImage(webcamRef.current?.video!);
        setQrCodeText(result);
        const now = Date.now();
        if (now - lastItemScanTimeRef.current > 2000) {
          if (player.status === "dead" && result !== "revive") {
            socketRef.current?.emit("notification", "Cannot scan items: You are dead");
          } else if (["pistol", "rifle", "sniper"].includes(result) && player.status === "alive") {
            const weapons = [
              { type: "Pistol", damage: 10, cost: 0 },
              { type: "Rifle", damage: 20, cost: 0 },
              { type: "Sniper", damage: 50, cost: 0 }
            ];
            const weapon = weapons.find((w) => w.type.toLowerCase() === result);
            if (weapon) {
              socketRef.current?.emit("purchaseWeapon", {
                gameId: gameState.id,
                playerId: socketRef.current?.id,
                weapon
              });
              setNotifications((prev) => [...prev, `Scanned ${result} weapon`].slice(-3));
              triggerVibration();
              new Audio("/sounds/powerup.wav").play().catch((e) => console.error("Sound error:", e));
            }
          } else if (result === "treasure" && player.status === "alive") {
            socketRef.current?.emit("collectTreasure", {
              gameId: gameState.id,
              playerId: socketRef.current?.id,
              item: result
            });
            setNotifications((prev) => [...prev, `Scanned treasure`].slice(-3));
            triggerVibration();
            new Audio("/sounds/lasershot.mp3").play().catch((e) => console.error("Sound error:", e));
          } else if (result === "revive" && player.status === "dead") {
            socketRef.current?.emit("revivePlayer", {
              gameId: gameState.id,
              playerId: socketRef.current?.id
            });
            setNotifications((prev) => [...prev, `Scanned revive`].slice(-3));
            triggerVibration();
            new Audio("/sounds/lasershot.mp3").play().catch((e) => console.error("Sound error:", e));
          }
          lastItemScanTimeRef.current = now;
        }
      } catch (error) {
        setQrCodeText(null); // Clear text if no QR code is detected
      }
    };

    const poseInterval = setInterval(detectPoses, 1000 / 60); // 60 FPS for pose detection
    const qrInterval = setInterval(detectQRCode, 1000 / 5); // 5 FPS for QR code detection
    return () => {
      clearInterval(poseInterval);
      clearInterval(qrInterval);
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
      } else {
        setNotifications((prev) => [...prev, "Insufficient points for weapon"].slice(-3));
      }
    } else if (item === "life" && player.points >= 100) {
      socketRef.current.emit("purchaseLife", { gameId: gameState.id, playerId: player.id });
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
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-red-500 mb-4">Game Over</h1>
          <p className="text-lg">You have been eliminated. Check the scores at /scores.</p>
          {qrCodeText && (
            <div className="text-2xl text-green-500 mt-4">{qrCodeText}</div>
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
        />
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
        {/* QR Code Text Overlay */}
        {qrCodeText && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-2xl text-green-500 bg-black/50 px-4 py-2 rounded pointer-events-none">
            {qrCodeText}
          </div>
        )}
      </div>

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
