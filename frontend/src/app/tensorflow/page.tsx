"use client";
import "@tensorflow/tfjs-backend-webgl";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { ready } from "@tensorflow/tfjs";

async function requestCameraPermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: true 
        });
        
        stream.getTracks().forEach(track => track.stop());
        
        return true;
    } catch (error) {
        console.error('Camera permission denied or error:', error);
        
        return false;
    }
}

const loadModelAndDetect = async (webcamRef: React.RefObject<Webcam>) => {
    // Check if the ref and its current value exist
    if (!webcamRef.current?.video) {
        console.error("Webcam not ready");
        return;
    }

    const model = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet);
    const predictions = await model.estimatePoses(webcamRef.current.video);

    console.log(predictions);
}

// Function to extract bounding box around body (excluding arms)
export const extractBodyBoundingBox = (
    pose: poseDetection.Pose,
    confidenceThreshold: number = 0.3,
    padding: number = 10
): { x: number; y: number; width: number; height: number } | null => {
    if (!pose.keypoints || pose.keypoints.length === 0) {
        return null;
    }

    // Define core body keypoints - focus on torso area primarily
    const coreBodyKeypointNames = [
        'nose', // Head reference point
        'left_shoulder', 'right_shoulder', // Shoulders 
        'left_hip', 'right_hip', // Hips
    ];

    // Filter keypoints to only include core body parts
    const validBodyKeypoints = pose.keypoints.filter(keypoint => 
        keypoint.name && 
        coreBodyKeypointNames.includes(keypoint.name) &&
        keypoint.score && 
        keypoint.score > confidenceThreshold
    );

    if (validBodyKeypoints.length < 3) {
        return null; // Need at least 3 points for a meaningful bounding box
    }

    // Find the bounds of the core body keypoints
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    validBodyKeypoints.forEach(keypoint => {
        // For shoulders, be very conservative with horizontal extent
        if (keypoint.name === 'left_shoulder' || keypoint.name === 'right_shoulder') {
            // Use minimal horizontal range for shoulders to focus on torso
            const shoulderInset = 10; // Pull shoulders inward to focus on torso
            if (keypoint.x + shoulderInset < minX) minX = keypoint.x + shoulderInset;
            if (keypoint.x - shoulderInset > maxX) maxX = keypoint.x - shoulderInset;
        } else {
            // For head and hips, use normal coordinates but with slight inset
            const bodyInset = 5;
            if (keypoint.x + bodyInset < minX) minX = keypoint.x + bodyInset;
            if (keypoint.x - bodyInset > maxX) maxX = keypoint.x - bodyInset;
        }
        
        if (keypoint.y < minY) minY = keypoint.y;
        if (keypoint.y > maxY) maxY = keypoint.y;
    });

    // Ensure we have valid bounds
    if (minX >= maxX) {
        // Fallback: use shoulder distance as width reference
        const leftShoulder = validBodyKeypoints.find(kp => kp.name === 'left_shoulder');
        const rightShoulder = validBodyKeypoints.find(kp => kp.name === 'right_shoulder');
        if (leftShoulder && rightShoulder) {
            const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
            const centerX = (leftShoulder.x + rightShoulder.x) / 2;
            minX = centerX - shoulderWidth * 0.3; // 30% of shoulder width on each side
            maxX = centerX + shoulderWidth * 0.3;
        }
    }

    // Calculate tighter bounding box with reduced padding
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    const width = (maxX - minX) + (2 * padding);
    const height = (maxY - minY) + (2 * padding);

    return {
        x: x,
        y: y,
        width: width,
        height: height
    };
};

// Function to draw the body bounding box on canvas
const drawBodyBoundingBox = (
    pose: poseDetection.Pose,
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    webcamRef: React.RefObject<Webcam | null>,
    confidenceThreshold: number = 0.3
) => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = webcamRef.current?.video;

    if (!ctx || !video) {
        console.error("Canvas or video not ready for bounding box");
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

    // Extract body bounding box
    const boundingBox = extractBodyBoundingBox(pose, confidenceThreshold);
    
    if (boundingBox) {
        // Scale bounding box to display coordinates
        const scaledX = boundingBox.x * scaleX;
        const scaledY = boundingBox.y * scaleY;
        const scaledWidth = boundingBox.width * scaleX;
        const scaledHeight = boundingBox.height * scaleY;

        // Draw bounding box
        ctx.strokeStyle = "rgba(0, 255, 0, 0.9)"; // Brighter green
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]); // Smaller dashes for tighter box
        ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);
        ctx.setLineDash([]); // Reset line dash

        // Draw label with background for better visibility
        ctx.fillStyle = "rgba(0, 255, 0, 0.8)";
        ctx.fillRect(scaledX, scaledY - 20, 45, 16);
        ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
        ctx.font = "12px Arial";
        ctx.fillText("Torso", scaledX + 2, scaledY - 8);
    }
};

// Use a lower confidence threshold for drawing at high framerates to ensure more consistent visualization
const drawDetections = (
    detections: poseDetection.Pose[], 
    canvasRef: React.RefObject<HTMLCanvasElement | null>, 
    webcamRef: React.RefObject<Webcam | null>,
    highFpsMode: boolean = true
) => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = webcamRef.current?.video;

    if (!ctx || !video) {
        console.error("Canvas or video not ready");
        return;
    }

    // Set canvas dimensions to match the displayed video
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get the actual video dimensions and displayed dimensions
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;

    // Set canvas size to match the displayed video
    canvas.width = displayWidth;
    canvas.height = displayHeight;

    // Calculate scaling factors
    const scaleX = displayWidth / videoWidth;
    const scaleY = displayHeight / videoHeight;

    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Use a much lower confidence threshold in high FPS mode (60fps)
    const confidenceThreshold = highFpsMode ? 0.1 : 0.5;
    
    // Define connections between keypoints to draw skeleton
    // Using arrays of indices for faster lookup at high framerates
    const connections = [
        ['left_ear', 'left_eye'], ['left_eye', 'nose'], ['nose', 'right_eye'],
        ['right_eye', 'right_ear'], ['left_shoulder', 'right_shoulder'],
        ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
        ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
        ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
        ['left_hip', 'right_hip'], ['left_hip', 'left_knee'],
        ['left_knee', 'left_ankle'], ['right_hip', 'right_knee'],
        ['right_knee', 'right_ankle']
    ];
    
    // Draw all detected poses
    detections.forEach(pose => {
        if (!pose.keypoints || pose.keypoints.length === 0) return;
        
        const keypoints = pose.keypoints;
        
        // Create a map of keypoints by name for easier lookup
        const keypointMap = keypoints.reduce((map, keypoint) => {
            if (keypoint.name) {
                map[keypoint.name] = keypoint;
            }
            return map;
        }, {} as Record<string, poseDetection.Keypoint>);
        
        // Draw connections (skeleton) - optimized for high framerates
        ctx.strokeStyle = "rgba(0, 128, 255, 0.9)"; // Semi-transparent blue
        ctx.lineWidth = 3;
        
        // Use a more direct rendering approach to improve performance
        connections.forEach(([from, to]) => {
            const fromKeypoint = keypointMap[from];
            const toKeypoint = keypointMap[to];
            
            if (fromKeypoint && toKeypoint && 
                fromKeypoint.score && fromKeypoint.score > confidenceThreshold &&
                toKeypoint.score && toKeypoint.score > confidenceThreshold) {
                
                // Scale coordinates to match display size
                const scaledFromX = fromKeypoint.x * scaleX;
                const scaledFromY = fromKeypoint.y * scaleY;
                const scaledToX = toKeypoint.x * scaleX;
                const scaledToY = toKeypoint.y * scaleY;
                
                // Draw the line connecting keypoints
                ctx.beginPath();
                ctx.moveTo(scaledFromX, scaledFromY);
                ctx.lineTo(scaledToX, scaledToY);
                ctx.stroke();
            }
        });

        // Draw keypoints - optimized for high framerates
        keypoints.forEach(keypoint => {
            if (keypoint.score && keypoint.score > confidenceThreshold) {
                const x = keypoint.x;
                const y = keypoint.y;

                // Scale the coordinates to match the displayed video size
                const scaledX = x * scaleX;
                const scaledY = y * scaleY;

                // Draw filled circle for each keypoint
                ctx.fillStyle = "rgba(255, 0, 0, 0.9)"; // Semi-transparent red
                ctx.beginPath();
                ctx.arc(scaledX, scaledY, 4, 0, 2 * Math.PI);
                ctx.fill();
            }
        });

        // Draw the body bounding box
        drawBodyBoundingBox(pose, canvasRef, webcamRef, confidenceThreshold);
    }); 
};

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
    // Track FPS for debugging
    const [fps, setFps] = useState<number>(0);
    const [detectionFps, setDetectionFps] = useState<number>(0);
    const frameCountRef = useRef<number>(0);
    const detectionCountRef = useRef<number>(0);
    const lastFpsUpdateRef = useRef<number>(0);
    
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
    }, []);
    
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
                    
                    // Log successful detection for debugging
                    console.log("Detected pose at 60fps");
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
    }, [model]);
    
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
                                width: 480,
                                height: 640,
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
                    </div>
                    
                    <div style={{ marginTop: '15px' }}>
                        <h3>MoveNet Pose Detection</h3>
                        <p>Stand in view of the camera to detect your pose.</p>
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