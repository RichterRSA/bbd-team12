"use client";
import React, { useRef } from 'react';
import { Camera, AlertCircle, X, Play, Pause, Zap, LogOut } from 'lucide-react';
import Webcam from "react-webcam";
import { Socket } from 'socket.io-client';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { Player, GameState } from './types';
import { ColorSample, AveragedColorResult, getColorStyle } from '@/utils/colorDetection';
import { isMobileDevice } from '@/utils/deviceUtils';

interface ColorConfirmationViewProps {
  gameState: GameState;
  socket: Socket | null;
  isHost: boolean;
  webcamRef: React.RefObject<Webcam | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hasCameraPermission: boolean | null;
  showCamera: boolean;
  isScanning: boolean;
  scanProgress: number;
  colorSamples: ColorSample[];
  finalResult: AveragedColorResult | null;
  currentPoses: poseDetection.Pose[];
  poseModel: poseDetection.PoseDetector | null;
  isSubmittingColor: boolean;
  handleSubmitColorConfirmation: (targetId: string, color: string) => void;
  startColorScan: () => void;
  stopColorScan: () => void;
  setShowCamera: (show: boolean) => void;
  setShowConfirmation: (show: boolean) => void;
  showNotification: (message: string, type: 'success' | 'info' | 'error') => void;
}

export const ColorConfirmationView: React.FC<ColorConfirmationViewProps> = ({
  gameState,
  socket,
  isHost,
  webcamRef,
  canvasRef,
  hasCameraPermission,
  showCamera,
  isScanning,
  scanProgress,
  colorSamples,
  finalResult,
  currentPoses,
  poseModel,
  isSubmittingColor,
  handleSubmitColorConfirmation,
  startColorScan,
  stopColorScan,
  setShowCamera,
  setShowConfirmation,
  showNotification,
}) => {
  const currentTarget = gameState.players[gameState.confirmationPhase!.currentTargetIndex];
  const isCurrentPlayerTarget = currentTarget?.id === socket?.id;
  const hasAlreadyConfirmed = gameState.confirmationPhase!.confirmations[`${socket?.id}->${currentTarget?.id}`];

  return (
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
            <span>{gameState.confirmationPhase!.currentTargetIndex + 1} / {gameState.players.length}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${((gameState.confirmationPhase!.currentTargetIndex + 1) / gameState.players.length) * 100}%` }}
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
              onClick={() => setShowCamera(true)}
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
                />
              ) : (
                <div className="w-full h-64 bg-gray-800 flex items-center justify-center">
                  <div className="text-center">
                    <Camera className="mx-auto mb-4 text-gray-400" size={48} />
                    <p className="text-gray-400">Camera permission required for AI color detection</p>
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
                    </div>
                  </div>
                </div>
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
          <div className="mt-6 pt-6 border-t border-gray-700 flex justify-end">
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
};
