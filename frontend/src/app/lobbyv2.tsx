"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Webcam from "react-webcam";
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { Camera, X, Play, AlertCircle, Pause } from 'lucide-react';
import {
  requestCameraPermission,
  extractTorsoColor,
  drawDetections,
  isMobileDevice,
} from '@/utils/poseDetection';
import { 
  ColorScanner, 
  ColorSample, 
  AveragedColorResult, 
  getColorStyle 
} from '@/utils/colorDetection';

const LobbyV2 = () => {
  // Camera and pose detection state
  const [poseModel, setPoseModel] = useState<poseDetection.PoseDetector | null>(null);
  const [currentPoses, setCurrentPoses] = useState<poseDetection.Pose[]>([]);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  
  // Color scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [colorSamples, setColorSamples] = useState<ColorSample[]>([]);
  const [finalResult, setFinalResult] = useState<AveragedColorResult | null>(null);
  
  // UI state
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'info' | 'error'} | null>(null);
  
  // Refs
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorScannerRef = useRef<ColorScanner | null>(null);

  // Constants
  const SCAN_DURATION = 1000; // 1 second in milliseconds
  const SAMPLE_INTERVAL = 50; // Sample every 50ms (20 samples per second)

  // Show notification helper
  const showNotification = useCallback((message: string, type: 'success' | 'info' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  // Load pose detection model and request camera permission
  useEffect(() => {
    async function initializeCV() {
      try {
        // Ensure TensorFlow is ready
        await tf.ready();
        console.log("TensorFlow.js is ready");

        // Request camera permission
        const hasPermission = await requestCameraPermission(showNotification);
        setHasCameraPermission(hasPermission);

        // Load pose detection model
        console.log("Loading MoveNet model...");
        const modelConfig: poseDetection.MoveNetModelConfig = {
          modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
          enableSmoothing: false,
          minPoseScore: 0.1,
          enableTracking: false,
        };
        
        const model = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          modelConfig
        );
        setPoseModel(model);
        console.log("MoveNet model loaded successfully");
        showNotification("AI model loaded successfully!", "success");
      } catch (error) {
        console.error("Error initializing computer vision:", error);
        showNotification("Failed to load AI model. Please refresh the page.", "error");
      }
    }

    initializeCV();
  }, [showNotification]);

  // Pose detection loop when camera is active
  useEffect(() => {
    let detectionInterval: NodeJS.Timeout | null = null;

    const detectPoses = async () => {
      if (!poseModel || !webcamRef.current?.video || !showCamera) return;

      const video = webcamRef.current.video;
      if (video.readyState !== 4) return;

      try {
        const poses = await poseModel.estimatePoses(video, {
          flipHorizontal: false,
          maxPoses: 1
        });

        setCurrentPoses(poses);
      } catch (error) {
        console.error("Error detecting poses:", error);
      }
    };

    if (showCamera && poseModel) {
      detectionInterval = setInterval(detectPoses, 100); // 10 FPS
    }

    return () => {
      if (detectionInterval) clearInterval(detectionInterval);
    };
  }, [showCamera, poseModel]);

  // Initialize ColorScanner when pose model and camera are ready
  useEffect(() => {
    if (poseModel && webcamRef.current?.video && showCamera) {
      const videoElement = webcamRef.current.video;
      
      if (!colorScannerRef.current) {
        colorScannerRef.current = new ColorScanner({
          scanDuration: SCAN_DURATION,
          sampleInterval: SAMPLE_INTERVAL
        });
      }
      
      colorScannerRef.current.initialize(poseModel, videoElement);
      colorScannerRef.current.setCallbacks({
        onProgress: (progress, samples) => {
          setScanProgress(progress);
          setColorSamples(samples);
        },
        onComplete: (result) => {
          setIsScanning(false);
          setFinalResult(result);
          showNotification(`Color scanning complete! Detected: ${result.dominantColor}`, "success");
        },
        onError: (error) => {
          setIsScanning(false);
          showNotification(error, "error");
        }
      });
    }
  }, [poseModel, showCamera, SCAN_DURATION, SAMPLE_INTERVAL, showNotification]);

  // Drawing/rendering loop for pose overlay
  useEffect(() => {
    let renderFrameId: number | null = null;
    
    const renderFrame = () => {
      if (currentPoses.length > 0 && showCamera) {
        drawDetections(currentPoses, canvasRef, webcamRef, true, 80);
      }
      
      renderFrameId = requestAnimationFrame(renderFrame);
    };
    
    if (showCamera) {
      renderFrameId = requestAnimationFrame(renderFrame);
    }
    
    return () => {
      if (renderFrameId !== null) {
        cancelAnimationFrame(renderFrameId);
      }
    };
  }, [currentPoses, showCamera]);

  // Start color scanning
  const startColorScan = useCallback(() => {
    if (isScanning || !colorScannerRef.current) return;
    
    setIsScanning(true);
    setScanProgress(0);
    setColorSamples([]);
    setFinalResult(null);
    
    showNotification("Starting 1-second color scan...", "info");
    colorScannerRef.current.startScan();
  }, [isScanning, showNotification]);

  // Stop color scanning
  const stopColorScan = useCallback(() => {
    if (!isScanning || !colorScannerRef.current) return;
    
    colorScannerRef.current.stopScan();
    setIsScanning(false);
  }, [isScanning]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (colorScannerRef.current) {
        colorScannerRef.current.dispose();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-violet-900 flex items-center justify-center p-4">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg transition-all duration-300 ${
          notification.type === 'success' ? 'bg-green-600 text-white' :
          notification.type === 'error' ? 'bg-red-600 text-white' :
          'bg-blue-600 text-white'
        }`}>
          <div className="flex items-center">
            <AlertCircle size={20} className="mr-2" />
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      <div className="w-full max-w-4xl bg-gray-800/90 backdrop-blur-sm rounded-lg border border-purple-800 shadow-xl p-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
            🎨 Advanced Color Scanner
          </h1>
          <p className="text-purple-300 text-lg">AI-powered 1-second color averaging for precise detection</p>
        </div>

        {/* Main Content */}
        <div className="space-y-6">
          {/* Camera Controls */}
          <div className="flex justify-center space-x-4">
            {!showCamera ? (
              <button
                onClick={() => setShowCamera(true)}
                disabled={!hasCameraPermission}
                className="flex items-center px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 transition-all duration-200"
              >
                <Camera size={20} className="mr-2" />
                Start Camera
              </button>
            ) : (
              <button
                onClick={() => {
                  setShowCamera(false);
                  if (isScanning) stopColorScan();
                }}
                className="flex items-center px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-all duration-200"
              >
                <X size={20} className="mr-2" />
                Stop Camera
              </button>
            )}
          </div>

          {/* Camera View */}
          {showCamera && (
            <div className="relative bg-black rounded-lg overflow-hidden">
              {hasCameraPermission ? (
                <>
                  <Webcam
                    ref={webcamRef}
                    audio={false}
                    className="w-full h-80 object-cover"
                    screenshotFormat="image/jpeg"
                    videoConstraints={{
                      width: { ideal: 640 },
                      height: { ideal: 480 },
                      facingMode: isMobileDevice() ? { ideal: "environment" } : { ideal: "user" }
                    }}
                    onUserMedia={(stream) => {
                      console.log("Camera access granted successfully");
                    }}
                    onUserMediaError={(error) => {
                      console.error("Camera access error:", error);
                      setHasCameraPermission(false);
                      setShowCamera(false);
                      showNotification("Camera access failed. Please check permissions and try again.", "error");
                    }}
                  />
                  
                  {/* Pose detection overlay */}
                  <canvas
                    ref={canvasRef}
                    className="absolute top-0 left-0 w-full h-80 pointer-events-none"
                    style={{ mixBlendMode: 'normal' }}
                  />
                  
                  {/* Status overlay */}
                  <div className="absolute bottom-4 left-4 right-4 bg-black/80 text-white p-3 rounded-lg">
                    <p className="text-sm text-center">
                      {currentPoses.length === 0 
                        ? "🔍 Looking for person in frame..." 
                        : "✅ Person detected! Ready to scan."
                      }
                    </p>
                  </div>
                </>
              ) : (
                <div className="w-full h-80 bg-gray-800 flex items-center justify-center">
                  <div className="text-center">
                    <Camera className="mx-auto mb-4 text-gray-400" size={48} />
                    <p className="text-gray-400 mb-4">Camera permission required for color detection</p>
                    <button
                      onClick={async () => {
                        const hasPermission = await requestCameraPermission(showNotification);
                        setHasCameraPermission(hasPermission);
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
                    >
                      Grant Camera Access
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Scan Controls */}
          {showCamera && hasCameraPermission && (
            <div className="text-center">
              {!isScanning ? (
                <button
                  onClick={startColorScan}
                  disabled={currentPoses.length === 0}
                  className="flex items-center justify-center mx-auto px-8 py-4 bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-lg hover:from-green-500 hover:to-blue-500 disabled:opacity-50 transition-all duration-200 text-lg font-semibold"
                >
                  <Play size={24} className="mr-2" />
                  Start 1-Second Color Scan
                </button>
              ) : (
                <button
                  onClick={stopColorScan}
                  className="flex items-center justify-center mx-auto px-8 py-4 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-all duration-200 text-lg font-semibold"
                >
                  <Pause size={24} className="mr-2" />
                  Stop Scanning
                </button>
              )}
            </div>
          )}

          {/* Scan Progress */}
          {isScanning && (
            <div className="space-y-2">
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
            <div className="bg-gray-700/50 rounded-lg p-6 space-y-4">
              <h3 className="text-xl font-bold text-white text-center mb-4">Color Analysis Results</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Color Display */}
                <div className="space-y-3">
                  <h4 className="font-semibold text-gray-300">Detected Color</h4>
                  <div className="flex items-center space-x-4">
                    <div 
                      className="w-20 h-20 rounded-lg border-2 border-gray-600"
                      style={getColorStyle(finalResult.averageRgb)}
                    />
                    <div>
                      <p className="text-lg font-bold text-white capitalize">{finalResult.dominantColor}</p>
                      <p className="text-sm text-gray-400">
                        RGB({finalResult.averageRgb.r}, {finalResult.averageRgb.g}, {finalResult.averageRgb.b})
                      </p>
                    </div>
                  </div>
                </div>

                {/* Statistics */}
                <div className="space-y-3">
                  <h4 className="font-semibold text-gray-300">Scan Statistics</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Confidence:</span>
                      <span className="text-white">{Math.round(finalResult.confidence * 100)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Samples:</span>
                      <span className="text-white">{finalResult.sampleCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Duration:</span>
                      <span className="text-white">{finalResult.detectionDuration}ms</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Sample Rate:</span>
                      <span className="text-white">{Math.round(finalResult.sampleCount / (finalResult.detectionDuration / 1000))} Hz</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Samples */}
              {colorSamples.length > 0 && (
                <div className="mt-6">
                  <h4 className="font-semibold text-gray-300 mb-3">Sample History</h4>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {colorSamples.slice(-20).map((sample, index) => (
                      <div
                        key={index}
                        className="w-8 h-8 rounded border border-gray-600 flex-shrink-0"
                        style={getColorStyle(sample.rgb)}
                        title={`${sample.color} - Confidence: ${Math.round(sample.confidence * 100)}%`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Showing last 20 samples (hover for details)
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LobbyV2;
