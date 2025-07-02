"use client";
import React, { useState } from 'react';
import { Camera, LogOut, Menu, Info } from 'lucide-react';
import Webcam from "react-webcam";
import * as poseDetection from '@tensorflow-models/pose-detection';
import { isMobileDevice, requestCameraPermission } from '@/utils/deviceUtils';
import { GameState, Player } from './types';

interface GameViewProps {
  gameState: GameState;
  currentPlayer: Player | undefined;
  playerName: string;
  webcamRef: React.RefObject<Webcam | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hasCameraPermission: boolean | null;
  setHasCameraPermission: (permission: boolean) => void;
  currentPoses: poseDetection.Pose[];
  setShowConfirmation: (show: boolean) => void;
  showNotification: (message: string, type: 'success' | 'info' | 'error') => void;
}

export const GameView: React.FC<GameViewProps> = ({
  gameState,
  currentPlayer,
  playerName,
  webcamRef,
  canvasRef,
  hasCameraPermission,
  setHasCameraPermission,
  currentPoses,
  setShowConfirmation,
  showNotification,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      {/* Main Game View */}
      <div className="relative w-full h-full">
        {hasCameraPermission ? (
          <div className="relative w-full h-full">
            <Webcam
              ref={webcamRef}
              audio={false}
              className="w-full h-full object-cover"
              screenshotFormat="image/jpeg"
              videoConstraints={{
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                facingMode: isMobileDevice() ? { ideal: "environment" } : { ideal: "user" }
              }}
            />
            
            {/* Game UI Overlays */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Player Info Overlay - Top Left */}
              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm rounded-lg p-3 text-white">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-sm">{currentPlayer?.name || playerName}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div>
                      HP: <span className={`font-bold ${
                        (currentPlayer?.health || 0) > 50 ? 'text-green-400' : 
                        (currentPlayer?.health || 0) > 20 ? 'text-yellow-400' : 'text-red-400'
                      }`}>{currentPlayer?.health || 0}</span>
                    </div>
                    <div>
                      Score: <span className="font-bold text-blue-400">{currentPlayer?.points || 0}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Weapon Info - Top Right */}
              {currentPlayer?.weapon && (
                <div className="absolute top-4 right-16 bg-black/60 backdrop-blur-sm rounded-lg p-3">
                  <div className="text-white text-sm">
                    <div className="flex items-center gap-2">
                      <span>🔫</span>
                      <span>{currentPlayer.weapon.type}</span>
                      <span className="text-red-400">({currentPlayer.weapon.damage} DMG)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Crosshair and targeting */}
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                <div className="w-32 h-32 border-4 border-green-400 bg-green-400/10 rounded-full relative">
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <div className="w-8 h-1 bg-green-400"></div>
                    <div className="w-1 h-8 bg-green-400 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"></div>
                  </div>
                </div>
              </div>

              {/* Target Detection Indicator */}
              {currentPoses.length > 0 && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-black px-4 py-2 rounded-full text-sm font-bold animate-pulse">
                  Target Locked
                </div>
              )}
            </div>
            
            {/* Pose detection overlay */}
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-60"
              style={{ mixBlendMode: 'screen' }}
            />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
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

        {/* Menu Button */}
        <div className="absolute top-4 right-4 z-10">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="bg-black/60 backdrop-blur-sm text-white p-2 rounded-lg hover:bg-black/80 transition-all"
          >
            <Menu size={20} />
          </button>

          {/* Dropdown Menu */}
          {showMenu && (
            <div className="absolute top-full right-0 mt-2 w-48 bg-black/90 backdrop-blur-sm rounded-lg overflow-hidden border border-gray-800">
              <button
                onClick={() => {
                  setShowInstructions(true);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-3 text-left text-white hover:bg-gray-800 flex items-center gap-2"
              >
                <Info size={18} />
                How to Play
              </button>
              <button
                onClick={() => {
                  setShowConfirmation(true);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-3 text-left text-red-400 hover:bg-gray-800 flex items-center gap-2"
              >
                <LogOut size={18} />
                Leave Game
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Instructions Modal */}
      {showInstructions && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h4 className="font-semibold text-green-200 mb-4 text-lg">🎮 How to Play</h4>
            <ul className="text-sm text-green-100 space-y-2">
              <li className="flex items-start gap-2">
                <span>•</span>
                <span><strong>Aim:</strong> Point your camera at opponents wearing different colored shirts</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span><strong>Shoot:</strong> When a person appears in the crosshair, the system will auto-shoot</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span><strong>Avoid:</strong> Don't let opponents point their cameras at you!</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span><strong>Score:</strong> Hit opponents to gain points and reduce their health</span>
              </li>
            </ul>
            <button
              onClick={() => setShowInstructions(false)}
              className="mt-6 w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-all"
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
