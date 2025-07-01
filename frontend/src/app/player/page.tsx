"use client";

import React, { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { io, Socket } from "socket.io-client";
import { drawCrosshair, drawDetections, isPersonInCrosshair, triggerVibration } from "../tensorflow/page";

// Define types for game data
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
  const webcamRef = useRef<Webcam | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastShotTimeRef = useRef<number>(0);

  // Initialize Socket.IO and TensorFlow model
  useEffect(() => {
    // Connect to backend
    socketRef.current = io("http://localhost:3001", { transports: ["websocket"] });
    
    // Load TensorFlow model
    const initModel = async () => {
      await import("@tensorflow/tfjs-backend-webgl");
      const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet);
      setModel(detector);
    };

    // Request camera permission
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
      setNotifications((prev) => [...prev, message].slice(-3)); // Keep last 3 notifications
      if (message.includes("shot") || message.includes("hit")) {
        triggerVibration();
        // Play sound
        new Audio("/sounds/laser.mp3").play().catch((e) => console.error("Sound error:", e));
      }
    });

    return () => {
      socketRef.current?.off("gameStateUpdate");
      socketRef.current?.off("notification");
    };
  }, []);

  // Handle pose detection and shooting logic
  useEffect(() => {
    if (!model || !webcamRef.current?.video || !canvasRef.current || !hasCameraPermission) return;

    const detectPoses = async () => {
      const video = webcamRef.current?.video;
      if (!video) return;

      const poses = await model.estimatePoses(video);
      drawDetections(poses, canvasRef, webcamRef, true, CROSSHAIR_RADIUS);

      // Check for shooting
      const now = Date.now();
      if (poses.length > 0 && isPersonInCrosshair(poses[0], video.videoWidth, video.videoHeight, CROSSHAIR_RADIUS)) {
        if (now - lastShotTimeRef.current > 1000) { // 1-second cooldown
          socketRef.current?.emit("shoot", {
            gameId: gameState?.id,
            playerId: socketRef.current?.id,
            weapon: player?.weapon,
          });
          lastShotTimeRef.current = now;
          triggerVibration();
          new Audio("/sounds/singleshot.mp3").play().catch((e) => console.error("Sound error:", e));
        }
      }
    };

    const interval = setInterval(detectPoses, 1000 / 60); // 60 FPS
    return () => clearInterval(interval);
  }, [model, gameState, player, hasCameraPermission]);

  // Handle purchasing weapons and lives
  const handlePurchase = (item: "weapon" | "life", type?: string) => {
    if (!socketRef.current || !gameState || !player) return;

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
    if (!socketRef.current || !gameState || !player) return;
    socketRef.current.emit("activatePowerUp", { gameId: gameState.id, playerId: player.id, powerUpType: type });
  };

  if (hasCameraPermission === false) {
    return <div className="text-white text-center p-4">Camera permission denied. Please enable camera access.</div>;
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

        {/* Minimap (Placeholder) */}
        <div className="absolute bottom-4 left-4 w-32 h-32 bg-gray-900/70 rounded pointer-events-auto">
          <div className="p-2 text-sm">Minimap (TBD)</div>
        </div>
      </div>
    </div>
  );
}