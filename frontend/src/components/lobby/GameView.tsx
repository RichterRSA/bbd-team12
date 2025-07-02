"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { Camera, LogOut, Menu, Info } from 'lucide-react';
import Webcam from "react-webcam";
import * as poseDetection from '@tensorflow-models/pose-detection';
import { isMobileDevice, requestCameraPermission } from '@/utils/deviceUtils';
import { GameState, Player } from './types';
import { getCrosshairTorsoColor, isPersonInCrosshair } from '@/utils/crosshairUtils';
import { rgbToHsv, colorDistance } from '@/utils/colorDetection';

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
  const [debugInfo, setDebugInfo] = useState<{
    detectedColor: string | null;
    playerMatches: Array<{
      player: Player;
      distance: number;
      match: boolean;
    }>;
  }>({ detectedColor: null, playerMatches: [] });

  // Function to determine if a color is close enough to be considered a match
  const isColorMatch = (colorA: string, colorB: string) => {
    const parseRgb = (color: string) => {
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        return {
          r: parseInt(match[1]),
          g: parseInt(match[2]),
          b: parseInt(match[3])
        };
      }
      return null;
    };

    const rgbA = parseRgb(colorA);
    const rgbB = parseRgb(colorB);

    if (!rgbA || !rgbB) return false;

    // Calculate color difference
    const distance = colorDistance(rgbA, rgbB);
    return distance < 30; // Increased threshold for more lenient color matching
  };

  // Function to determine crosshair color based on pose detection and color matching
  const getCrosshairState = useCallback(() => {
    if (!currentPoses || currentPoses.length === 0 || !webcamRef.current?.video) {
      return { 
        isTargetDetected: false, 
        color: "rgba(128, 128, 128, 0.6)",
        debugInfo: { detectedColor: null, playerMatches: [] }
      };
    }

    const video = webcamRef.current.video;

    // Check if any person is in the crosshair
    const personInCrosshair = currentPoses.some(pose => 
      isPersonInCrosshair(pose, video.videoWidth, video.videoHeight, 80)
    );

    if (!personInCrosshair) {
      return { 
        isTargetDetected: false, 
        color: "rgba(128, 128, 128, 0.6)",
        debugInfo: { detectedColor: null, playerMatches: [] }
      };
    }

    // Get the color of the person in crosshair
    const colorResult = getCrosshairTorsoColor(currentPoses, webcamRef, video.videoWidth, video.videoHeight, 80);
    
    if (!colorResult) {
      return { 
        isTargetDetected: true, 
        color: "rgba(255, 255, 0, 0.6)",
        debugInfo: { detectedColor: null, playerMatches: [] }
      };
    }

    // Analyze color matches with all players' shirt colors
    const playerMatches = gameState.players?.map(player => {
      // Use player's confirmed shirt color if available, otherwise use team color as fallback
      const playerColor = player.shirtColor || (player.team === 'red' ? 'rgb(220, 50, 50)' : 'rgb(50, 50, 220)');
      const match = isColorMatch(colorResult.color, playerColor);
      
      return {
        player,
        distance: colorDistance(
          parseRgb(colorResult.color) || { r: 0, g: 0, b: 0 },
          parseRgb(playerColor) || { r: 0, g: 0, b: 0 }
        ),
        match
      };
    }) || [];

    // Check if any player color matches
    const hasPlayerMatch = playerMatches.some(pm => pm.match);

    return {
      isTargetDetected: true,
      color: hasPlayerMatch ? "rgba(0, 255, 0, 0.6)" : "rgba(255, 255, 0, 0.6)", // Green if player detected, yellow if unknown person
      debugInfo: {
        detectedColor: colorResult.color,
        playerMatches
      }
    };
  }, [currentPoses, webcamRef, gameState.players]);

  const parseRgb = (color: string) => {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3])
      };
    }
    return null;
  };

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

              {/* Crosshair */}
              {(() => {
                const { isTargetDetected, color } = getCrosshairState();
                return (
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <div className={`w-32 h-32 border-4 rounded-full relative transition-colors duration-200`}
                         style={{ borderColor: color, backgroundColor: color.replace('0.6', '0.1') }}>
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                        <div className="w-8 h-1" style={{ backgroundColor: color }}></div>
                        <div className="w-1 h-8 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
                             style={{ backgroundColor: color }}></div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Target Detection Indicator */}
              {(() => {
                const state = getCrosshairState();
                if (state.isTargetDetected && state.debugInfo.playerMatches.length > 0) {
                  // Find the player with the lowest color distance
                  const closestMatch = state.debugInfo.playerMatches.reduce((prev, current) => 
                    prev.distance < current.distance ? prev : current
                  );
                  
                  // Only show if the distance is within an acceptable range
                  if (closestMatch.distance < 30) {
                    return (
                      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex flex-col items-center">
                        <div className="bg-green-500 text-black px-4 py-2 rounded-full text-sm font-bold animate-pulse mb-1">
                          Target Acquired: {closestMatch.player.name}
                        </div>
                        <div className="text-xs text-gray-300">
                          Match confidence: {Math.round((1 - closestMatch.distance / 30) * 100)}%
                        </div>
                      </div>
                    );
                  }
                }
                return null;
              })()}

              {/* Debug Information Overlay */}
              {(() => {
                const state = getCrosshairState();
                return state.debugInfo.detectedColor && (
                  <div className="absolute left-4 bottom-4 bg-black/80 backdrop-blur-sm rounded-lg p-3 text-white text-xs font-mono">
                    <div>Detected Color: {state.debugInfo.detectedColor}</div>
                    <div className="mt-2">Player Colors:</div>
                    {state.debugInfo.playerMatches.map((match, index) => (
                      <div key={index} className="flex items-center gap-2 mt-1">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: match.player.team }}></div>
                        <span>{match.player.name} ({match.player.team})</span>
                        <span className={match.match ? 'text-green-400' : 'text-red-400'}>
                          Distance: {Math.round(match.distance)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
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
