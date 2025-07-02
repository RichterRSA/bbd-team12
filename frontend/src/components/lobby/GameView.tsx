"use client";
import React from 'react';
import { Camera, LogOut } from 'lucide-react';
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
  return (
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

        {/* Camera View */}
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
                />
                
                {/* Game UI Overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  {/* Crosshair and targeting */}
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <div className="w-32 h-32 border-4 border-green-400 bg-green-400/10 rounded-full relative">
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                        <div className="w-8 h-1 bg-green-400"></div>
                        <div className="w-1 h-8 bg-green-400 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"></div>
                      </div>
                      
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
};
