"use client";
import "@tensorflow/tfjs-backend-webgl";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { ready } from "@tensorflow/tfjs";
import QrScanner from "qr-scanner";
import { 
  requestCameraPermission, 
  drawDetections,
  isPersonInCrosshair,
  triggerVibration,
} from "../../utils/poseDetection";
import { setupQrScannerWithWebcam, createSimpleQrHandler } from "../../utils/qrCodeScanning";

export default function TensorFlow() {
    const [model, setModel] = useState<poseDetection.PoseDetector | null>(null);
    const webcamRef: React.RefObject<Webcam | null> = useRef(null);
    const canvasRef: React.RefObject<HTMLCanvasElement | null> = useRef(null);
    const lastDetectionTimeRef = useRef<number>(0);
    
    // Add a buffer for frame interpolation at high framerates
    const lastPosesRef = useRef<poseDetection.Pose[]>([]);
    const currentPosesRef = useRef<poseDetection.Pose[]>([]);

    const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
    const [isDetecting, setIsDetecting] = useState<boolean>(false);
    
    // QR Code scanning state
    const [qrCodeText, setQrCodeText] = useState<string | null>(null);
    const [qrScanHistory, setQrScanHistory] = useState<string[]>([]);
    const qrScannerRef = useRef<QrScanner | null>(null);
    
    // Track FPS for debugging
    const [fps, setFps] = useState<number>(0);
    const [detectionFps, setDetectionFps] = useState<number>(0);
    const frameCountRef = useRef<number>(0);
    const detectionCountRef = useRef<number>(0);
    const lastFpsUpdateRef = useRef<number>(0);
    
    // State for centering functionality
    const [personCenteredStatus, setPersonCenteredStatus] = useState<boolean>(false);
    const [vibrationStatus, setVibrationStatus] = useState<string>("");
    const [crosshairRadius, setCrosshairRadius] = useState<number>(80); // Adjustable radius in pixels

    // Function to handle center check button press
    const handleCenterCheck = () => {
        if (currentPosesRef.current.length > 0 && webcamRef.current?.video) {
            const pose = currentPosesRef.current[0]; // Check first detected pose
            const video = webcamRef.current.video;
            const insideCrosshair = isPersonInCrosshair(pose, video.videoWidth, video.videoHeight, crosshairRadius);
            
            if (insideCrosshair) {
                const vibrated = triggerVibration();
                setVibrationStatus(vibrated ? "✅ Inside target! Phone vibrated" : "✅ Inside target! (Vibration not supported)");
            } else {
                setVibrationStatus("❌ Outside target - move inside the circle");
                // Explicitly do NOT vibrate when outside
            }
            
            // Clear status after 3 seconds
            setTimeout(() => setVibrationStatus(""), 3000);
        } else {
            setVibrationStatus("❌ No person detected");
            setTimeout(() => setVibrationStatus(""), 3000);
        }
    };
    
    // Initialize QR Scanner when webcam is ready
    useEffect(() => {
        if (!webcamRef.current?.video || !hasCameraPermission) return;

        const handleQrScan = createSimpleQrHandler(
            (result) => {
                setQrCodeText(result);
                setQrScanHistory((prev) => [result, ...prev.slice(0, 4)]); // Keep last 5 scans
                console.log("QR Code detected:", result);
                
                // Clear the QR code text after 3 seconds
                setTimeout(() => {
                    setQrCodeText(null);
                }, 3000);
            },
            triggerVibration
        );

        const cleanup = setupQrScannerWithWebcam(
            webcamRef,
            {
                onScan: handleQrScan,
                maxScansPerSecond: 3,
                highlightScanRegion: false,
                highlightCodeOutline: false
            },
            hasCameraPermission,
            (scanner) => {
                qrScannerRef.current = scanner;
            }
        );

        return cleanup;
    }, [hasCameraPermission, webcamRef.current?.video]);

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
        
        // This function handles rendering at full camera framerate (60fps)
        const renderFrame = (timestamp: number) => {
            // Calculate display FPS (should be close to camera framerate)
            frameCountRef.current++;
            if (timestamp - lastFpsUpdateRef.current >= 1000) {
                setFps(Math.round((frameCountRef.current * 1000) / (timestamp - lastFpsUpdateRef.current)));
                frameCountRef.current = 0;
                lastFpsUpdateRef.current = timestamp;
            }
            
            // Draw the latest pose data at every frame for smooth animation
            if (currentPosesRef.current.length > 0) {
                drawDetections(currentPosesRef.current, canvasRef, webcamRef, true);
            }
            
            renderFrameId = requestAnimationFrame(renderFrame);
        };
        
        renderFrameId = requestAnimationFrame(renderFrame);
        
        return () => {
            if (renderFrameId !== null) {
                cancelAnimationFrame(renderFrameId);
            }
        };
    }, [crosshairRadius]);
    
    // Set up pose detection loop separate from rendering for better performance
    useEffect(() => {
        let detectionIntervalId: NodeJS.Timeout | null = null;
        let detectionInProgress = false;
        const targetDetectionInterval = 1000 / 30; // Slightly slower for stability with 60fps video
        
        // Function to detect poses at a more controlled rate - optimized for 60fps
        const detectPose = async () => {
            if (detectionInProgress || !model || !webcamRef.current?.video) {
                return;
            }
            
            // Ensure video is ready
            if (webcamRef.current.video.readyState !== 4) {
                console.log("Video not ready yet");
                return;
            }
            
            const timestamp = performance.now();
            detectionInProgress = true;
            setIsDetecting(true);
            
            try {
                // Create a temporary canvas to downsample the video for 60fps processing
                // This helps MoveNet process high framerate video
                const tempCanvas = document.createElement('canvas');
                const tempCtx = tempCanvas.getContext('2d');
                
                if (!tempCtx) {
                    console.error("Could not create temporary context");
                    return;
                }
                
                // Use a smaller size for faster processing at 60fps
                tempCanvas.width = 320;  // Reduced size
                tempCanvas.height = 240; // Reduced size
                
                // Draw the current video frame onto the temporary canvas (downsampled)
                tempCtx.drawImage(
                    webcamRef.current.video, 
                    0, 0, 
                    webcamRef.current.video.videoWidth, webcamRef.current.video.videoHeight,
                    0, 0, 
                    tempCanvas.width, tempCanvas.height
                );
                
                // Run the model on the downsampled image
                const detections = await model.estimatePoses(
                    tempCanvas, // Use the canvas instead of video directly
                    { 
                        flipHorizontal: false,
                        maxPoses: 1
                    }
                );
                
                // Update detection FPS metric
                detectionCountRef.current++;
                if (timestamp - lastDetectionTimeRef.current >= 1000) {
                    setDetectionFps(Math.round((detectionCountRef.current * 1000) / 
                                   (timestamp - lastDetectionTimeRef.current)));
                    detectionCountRef.current = 0;
                    lastDetectionTimeRef.current = timestamp;
                }
                
                // Scale the detected keypoints back to the original video size
                if (detections.length > 0) {
                    const scaleX = webcamRef.current.video.videoWidth / tempCanvas.width;
                    const scaleY = webcamRef.current.video.videoHeight / tempCanvas.height;
                    
                    // Scale each keypoint
                    detections.forEach(pose => {
                        pose.keypoints.forEach(keypoint => {
                            keypoint.x = keypoint.x * scaleX;
                            keypoint.y = keypoint.y * scaleY;
                        });
                    });
                    
                    // Update the pose data
                    lastPosesRef.current = [...currentPosesRef.current];
                    currentPosesRef.current = detections;
                    
                    // Check if person is inside crosshair (for real-time indicator)
                    const insideCrosshair = isPersonInCrosshair(detections[0], webcamRef.current.video.videoWidth, webcamRef.current.video.videoHeight, crosshairRadius);
                    setPersonCenteredStatus(insideCrosshair);
                }
            } catch (error) {
                console.error("Error detecting poses:", error);
            } finally {
                detectionInProgress = false;
            }
        };
        
        // Start detection loop if model is loaded
        if (model) {
            // Run detection at a controlled interval for better stability
            detectionIntervalId = setInterval(detectPose, targetDetectionInterval);
            // Run detection once immediately
            detectPose();
        }
        
        // Clean up interval on unmount
        return () => {
            if (detectionIntervalId) {
                clearInterval(detectionIntervalId);
            }
        };
    }, [model, crosshairRadius]);
    
    useEffect(() => {
        async function loadModel() {
            try {
                console.log("Loading MoveNet model...");
                
                // Configure MoveNet specifically for maximum speed
                // Using the LIGHTNING model for significantly higher fps
                const modelConfig: poseDetection.MoveNetModelConfig = {
                    // Use the lightning model which is much faster
                    modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
                    // Disable smoothing for maximum performance
                    enableSmoothing: false,
                    // Set low threshold for faster processing
                    minPoseScore: 0.1,
                    // No tracking
                    enableTracking: false,
                };
                
                const poseModel = await poseDetection.createDetector(
                    poseDetection.SupportedModels.MoveNet,
                    modelConfig
                );
                setModel(poseModel);
                console.log("MoveNet model loaded successfully");
            } catch (error) {
                console.error("Error loading MoveNet model:", error);
            }
        }
        
        if (model === null) {
            loadModel();
        }
    }, [model]);

    return (
        <div>
            {hasCameraPermission === false && (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                    <p>Camera permission denied. Please allow camera access to use pose detection.</p>
                </div>
            )}
            
            {hasCameraPermission === null && (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                    <p>Requesting camera permission...</p>
                </div>
            )}
            
            {hasCameraPermission && (
                <div style={{ position: 'relative' }}>
                    {!model && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, background: 'rgba(0,0,0,0.7)', color: 'white', padding: '10px', borderRadius: '5px' }}>Loading MoveNet model...</div>}
                    
                    <div style={{ position: 'relative', width: '600px', height: '500px' }}>
                        <Webcam
                            audio={false}
                            ref={webcamRef}
                            screenshotFormat="image/jpeg"
                            style={{
                                width: "100%",
                                height: "100%",
                                borderRadius: '8px',
                                objectFit: 'cover'
                            }}
                            videoConstraints={{
                                facingMode: "environment", // Use front camera for face tracking
                                width: 320,
                                height: 480,
                                frameRate: { ideal: 30, min: 30 }, // Request 60fps
                                deviceId: undefined, // Will prompt for camera selection
                            }}
                            mirrored={false} // Don't mirror the camera
                            onUserMedia={() => console.log("Camera accessed successfully at high framerate")}
                            onUserMediaError={(err) => console.error("Camera error:", err)}
                        />
                        <canvas
                            ref={canvasRef}
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                height: "100%",
                                pointerEvents: "none", // Allow clicks to pass through to video
                            }}
                        />
                        
                        <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.5)', color: 'white', padding: '5px 10px', borderRadius: '15px', fontSize: '12px' }}>
                            {isDetecting ? 'MoveNet Active' : 'Initializing...'}
                            {fps > 0 && ` • Camera: ${fps} FPS`}
                            {detectionFps > 0 && ` • Detection: ${detectionFps} FPS`}
                        </div>
                        
                        {/* Centering indicator */}
                        <div style={{ 
                            position: 'absolute', 
                            top: '10px', 
                            right: '10px', 
                            background: personCenteredStatus ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 165, 0, 0.8)', 
                            color: 'white', 
                            padding: '5px 10px', 
                            borderRadius: '15px', 
                            fontSize: '12px',
                            fontWeight: 'bold'
                        }}>
                            {personCenteredStatus ? '✅ Inside Target' : '⚠️ Outside Target'}
                        </div>

                        {/* Crosshair size control */}
                        <div style={{
                            position: 'absolute',
                            top: '50px',
                            right: '10px',
                            background: 'rgba(0,0,0,0.7)',
                            color: 'white',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            fontSize: '12px'
                        }}>
                            <div style={{ marginBottom: '5px' }}>Target Size</div>
                            <input
                                type="range"
                                min="40"
                                max="150"
                                value={crosshairRadius}
                                onChange={(e) => setCrosshairRadius(Number(e.target.value))}
                                style={{
                                    width: '100px',
                                    cursor: 'pointer'
                                }}
                            />
                            <div style={{ fontSize: '10px', textAlign: 'center', marginTop: '2px' }}>
                                {crosshairRadius}px
                            </div>
                        </div>

                        {/* QR Code display */}
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

                        {/* QR Code history */}
                        {qrScanHistory.length > 0 && (
                            <div style={{
                                position: 'absolute',
                                top: '150px',
                                right: '10px',
                                background: 'rgba(0,0,0,0.8)',
                                color: 'white',
                                padding: '10px',
                                borderRadius: '8px',
                                fontSize: '11px',
                                maxWidth: '150px'
                            }}>
                                <div style={{ marginBottom: '5px', fontWeight: 'bold' }}>Recent QR Scans:</div>
                                {qrScanHistory.map((code, index) => (
                                    <div key={index} style={{ 
                                        marginBottom: '2px', 
                                        opacity: 1 - (index * 0.2),
                                        wordBreak: 'break-all'
                                    }}>
                                        {index + 1}. {code}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Center check button */}
                        <button
                            onClick={handleCenterCheck}
                            style={{
                                position: 'absolute',
                                bottom: '10px',
                                right: '10px',
                                background: personCenteredStatus ? '#4CAF50' : '#FF9800',
                                color: 'white',
                                border: 'none',
                                padding: '12px 20px',
                                borderRadius: '25px',
                                fontSize: '14px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
                                transition: 'all 0.2s ease',
                                zIndex: 10
                            }}
                            onMouseDown={(e) => {
                                e.currentTarget.style.transform = 'scale(0.95)';
                            }}
                            onMouseUp={(e) => {
                                e.currentTarget.style.transform = 'scale(1)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'scale(1)';
                            }}
                        >
                            📳 Check Position
                        </button>
                    </div>
                    
                    <div style={{ marginTop: '15px' }}>
                        <h3>MoveNet Pose Detection & QR Code Scanner</h3>
                        <p>Stand in view of the camera and move inside the circular target. When you&apos;re inside the target area, press the button to make your phone vibrate. Adjust the target size using the slider.</p>
                        <p><strong>QR Code Scanning:</strong> Point any QR code at the camera to scan it. Scanned codes will appear on screen and trigger vibration feedback. Recent scans are shown in the history panel.</p>
                        
                        {/* Status message display */}
                        {vibrationStatus && (
                            <div style={{
                                padding: '10px 15px',
                                borderRadius: '8px',
                                marginBottom: '10px',
                                backgroundColor: vibrationStatus.includes('✅') ? '#d4edda' : '#f8d7da',
                                border: vibrationStatus.includes('✅') ? '1px solid #c3e6cb' : '1px solid #f5c6cb',
                                color: vibrationStatus.includes('✅') ? '#155724' : '#721c24',
                                fontSize: '14px',
                                fontWeight: 'bold'
                            }}>
                                {vibrationStatus}
                            </div>
                        )}
                        
                        {/* QR Code controls */}
                        <div style={{ 
                            marginTop: '15px',
                            display: 'flex',
                            gap: '10px',
                            alignItems: 'center'
                        }}>
                            <button
                                onClick={() => {
                                    setQrCodeText(null);
                                    setQrScanHistory([]);
                                }}
                                style={{
                                    background: '#FF6B6B',
                                    color: 'white',
                                    border: 'none',
                                    padding: '8px 15px',
                                    borderRadius: '5px',
                                    fontSize: '12px',
                                    cursor: 'pointer'
                                }}
                            >
                                Clear QR Data
                            </button>
                            {qrCodeText && (
                                <div style={{
                                    padding: '5px 10px',
                                    background: '#e8f5e8',
                                    border: '1px solid #4CAF50',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    color: '#2E7D32'
                                }}>
                                    Last scan: <strong>{qrCodeText}</strong>
                                </div>
                            )}
                        </div>
                        
                        <div style={{ 
                            marginTop: '10px', 
                            display: 'flex', 
                            gap: '10px',
                            alignItems: 'center' 
                        }}>
                            <div style={{ 
                                padding: '5px 10px',
                                background: '#f0f0f0',
                                borderRadius: '4px',
                                fontSize: '14px'
                            }}>
                                Using 60 FPS camera
                            </div>
                            <div style={{ 
                                padding: '5px 10px',
                                background: '#f0f0f0',
                                borderRadius: '4px',
                                fontSize: '14px'
                            }}>
                                Detection rate: ~30 FPS
                            </div>
                            <div style={{ 
                                padding: '5px 10px',
                                background: '#e0f0ff',
                                borderRadius: '4px',
                                fontSize: '14px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px'
                            }}>
                                <div style={{width: '12px', height: '12px', borderRadius: '50%', background: isDetecting ? '#4CAF50' : '#FFA500'}}></div>
                                High FPS Mode {isDetecting ? 'Active' : 'Initializing'}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}