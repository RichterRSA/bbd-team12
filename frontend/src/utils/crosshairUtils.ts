import * as poseDetection from "@tensorflow-models/pose-detection";
import Webcam from "react-webcam";
import { extractTorsoRectangle, extractTorsoColorFromRect } from './torsoDetection';
import { isMobileDevice } from './deviceUtils';


// Helper function to detect if device is iPhone specifically
const isIPhone = () => {
    return /iPhone|iPod/.test(navigator.userAgent);
};

// Mobile-optimized crosshair radius based on device - MADE SMALLER FOR EASIER TARGETING
const getMobileOptimizedRadius = (baseRadius: number, videoWidth: number, videoHeight: number): number => {
    const mobile = isMobileDevice();
    const iPhone = isIPhone();
    
    // Make the detection area smaller for all devices - easier targeting
    let scaleFactor = 0.7; // Start with 70% of base radius for better targeting
    
    if (mobile) {
        // For mobile, make it even smaller since touch screens require more precision
        scaleFactor = iPhone ? 0.6 : 0.65; // iPhone gets smaller radius (60%), other mobile (65%)
    }
    
    const resolutionScale = Math.min(videoWidth, videoHeight) / 480; // Base 480p
    
    return Math.round(baseRadius * scaleFactor * resolutionScale);
};

// Enhanced confidence threshold for mobile devices - MADE MORE FORGIVING
const getMobileOptimizedConfidence = (): number => {
    const iPhone = isIPhone();
    const mobile = isMobileDevice();
    
    // Lower confidence thresholds for more forgiving detection
    if (iPhone) {
        return 0.25; // iPhone cameras are good, but still be forgiving
    } else if (mobile) {
        return 0.2;  // Other mobile devices get even lower threshold
    } else {
        return 0.3;  // Desktop/laptop webcams
    }
};

// Function to trigger phone vibration
export const triggerVibration = () => {
    if (navigator.vibrate) {
        // Vibrate for 200ms
        navigator.vibrate(200);
        console.log("Phone vibration triggered");
    } else {
        console.log("Vibration API not supported on this device");
        // Fallback: show visual feedback
        return false;
    }
    return true;
};

// Helper function to check if a rectangle intersects with a circle - MADE MORE FORGIVING
export const rectangleIntersectsCircle = (
  rectMinX: number,
  rectMinY: number, 
  rectMaxX: number,
  rectMaxY: number,
  circleX: number,
  circleY: number,
  radius: number
): boolean => {
  // Make detection more forgiving by expanding the effective radius slightly
  const forgivingRadius = radius * 1.15; // 15% larger detection area than visual circle
  
  // Find the closest point on the rectangle to the circle center
  const closestX = Math.max(rectMinX, Math.min(circleX, rectMaxX));
  const closestY = Math.max(rectMinY, Math.min(circleY, rectMaxY));
  
  // Calculate distance from circle center to this closest point
  const distance = Math.sqrt(
    Math.pow(circleX - closestX, 2) + 
    Math.pow(circleY - closestY, 2)
  );
  
  // Rectangle intersects circle if distance is less than or equal to forgiving radius
  return distance <= forgivingRadius;
};

// Function to check if person is inside the crosshair circle using torso box
export const isPersonInCrosshair = (
    pose: poseDetection.Pose,
    videoWidth: number,
    videoHeight: number,
    crosshairRadius: number,
    confidenceThreshold?: number
): boolean => {
    if (!pose.keypoints || pose.keypoints.length === 0) {
        return false;
    }

    // Use mobile-optimized confidence threshold if not provided
    const threshold = confidenceThreshold ?? getMobileOptimizedConfidence();
    
    // Get mobile-optimized radius
    const optimizedRadius = getMobileOptimizedRadius(crosshairRadius, videoWidth, videoHeight);

    // Extract the torso rectangle using the same logic as the drawing function
    const torsoRect = extractTorsoRectangle(pose, threshold);
    
    if (!torsoRect) {
        return false;
    }

    // Calculate frame center (crosshair center)
    const frameCenterX = videoWidth / 2;
    const frameCenterY = videoHeight / 2;

    // For mobile devices, also check if the pose is stable enough - MADE MORE FORGIVING
    if (isMobileDevice()) {
        // Check for minimum number of high-confidence keypoints - reduced requirements
        const highConfidenceKeypoints = pose.keypoints.filter(kp => kp.score && kp.score > threshold + 0.05); // Reduced from +0.1
        if (highConfidenceKeypoints.length < 3) { // Reduced from 5 to 3
            return false;
        }
    }

    // Check if the torso rectangle intersects with the crosshair circle
    return rectangleIntersectsCircle(
        torsoRect.minX,
        torsoRect.minY,
        torsoRect.maxX,
        torsoRect.maxY,
        frameCenterX,
        frameCenterY,
        optimizedRadius
    );
};

// Function to draw crosshair circle on canvas
export const drawCrosshair = (
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    webcamRef: React.RefObject<Webcam | null>,
    crosshairRadius: number,
    isPersonInside: boolean = false,
    color: string
) => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = webcamRef.current?.video;

    if (!ctx || !video) {
        return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get video and display dimensions
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;
    
    // Calculate scaling factors accounting for objectFit: 'cover'
    const videoAspectRatio = videoWidth / videoHeight;
    const displayAspectRatio = displayWidth / displayHeight;
    
    let scale: number;
    if (videoAspectRatio > displayAspectRatio) {
        // Video is wider than display - video will be scaled by height
        scale = displayHeight / videoHeight;
    } else {
        // Video is taller than display - video will be scaled by width
        scale = displayWidth / videoWidth;
    }

    // Calculate center of the display
    const centerX = displayWidth / 2;
    const centerY = displayHeight / 2;

    // Scale the radius based on camera resolution (480px height) to display coordinates
    // The crosshairRadius is already calculated based on 480px camera height, so we scale it to display
    const scaledRadius = crosshairRadius * scale;

    // Draw outer circle - MORE PROMINENT WHEN TARGET DETECTED
    ctx.strokeStyle = isPersonInside ? "rgba(0, 255, 0, 0.9)" : "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = isPersonInside ? 4 : 3; // Thicker when target detected
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, scaledRadius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw inner circle (smaller) - BRIGHTER WHEN TARGET DETECTED
    ctx.strokeStyle = isPersonInside ? "rgba(0, 255, 0, 0.8)" : "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = isPersonInside ? 2 : 1; // Thicker when target detected
    ctx.beginPath();
    ctx.arc(centerX, centerY, scaledRadius * 0.7, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw crosshair lines - BRIGHTER WHEN TARGET DETECTED
    ctx.strokeStyle = isPersonInside ? "rgba(0, 255, 0, 0.9)" : "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = isPersonInside ? 3 : 2; // Thicker when target detected
    
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(centerX - scaledRadius * 0.3, centerY);
    ctx.lineTo(centerX + scaledRadius * 0.3, centerY);
    ctx.stroke();
    
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - scaledRadius * 0.3);
    ctx.lineTo(centerX, centerY + scaledRadius * 0.3);
    ctx.stroke();

    // Draw center dot - LARGER WHEN TARGET DETECTED
    ctx.fillStyle = isPersonInside ? "rgba(0, 255, 0, 1.0)" : "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, isPersonInside ? 4 : 3, 0, 2 * Math.PI); // Larger when target detected
    ctx.fill();
};

// Function to get the torso color of the person in the crosshair
// If multiple people are in crosshair, returns the one closest to center
export const getCrosshairTorsoColor = (
  detections: poseDetection.Pose[],
  webcamRef: React.RefObject<Webcam | null>,
  videoWidth: number,
  videoHeight: number,
  crosshairRadius: number,
  confidenceThreshold: number = 0.3
): { color: string; confidence: number; distance: number } | null => {
  if (!detections || detections.length === 0) {
    return null;
  }

  const video = webcamRef.current?.video;
  if (!video) {
    console.error("Video not ready for color extraction");
    return null;
  }

  // Calculate frame center (crosshair center)
  const frameCenterX = videoWidth / 2;
  const frameCenterY = videoHeight / 2;

  // Find all people in the crosshair and their distances to center
  const candidatesInCrosshair: Array<{
    pose: poseDetection.Pose;
    distance: number;
    torsoRect: { minX: number; maxX: number; minY: number; maxY: number };
  }> = [];

  for (const pose of detections) {
    // Check if this person is in the crosshair
    if (isPersonInCrosshair(pose, videoWidth, videoHeight, crosshairRadius, confidenceThreshold)) {
      // Extract torso rectangle
      const torsoRect = extractTorsoRectangle(pose, confidenceThreshold);
      
      if (torsoRect) {
        // Calculate distance from torso center to crosshair center
        const torsoCenterX = (torsoRect.minX + torsoRect.maxX) / 2;
        const torsoCenterY = (torsoRect.minY + torsoRect.maxY) / 2;
        
        const distance = Math.sqrt(
          Math.pow(torsoCenterX - frameCenterX, 2) + 
          Math.pow(torsoCenterY - frameCenterY, 2)
        );

        candidatesInCrosshair.push({
          pose,
          distance,
          torsoRect
        });
      }
    }
  }

  if (candidatesInCrosshair.length === 0) {
    return null;
  }

  // Sort by distance to center (closest first)
  candidatesInCrosshair.sort((a, b) => a.distance - b.distance);

  // Extract color from the closest person's torso
  const closestCandidate = candidatesInCrosshair[0];
  
  // Use the same color extraction logic as extractTorsoColor but with our rectangle
  const colorResult = extractTorsoColorFromRect(
    closestCandidate.torsoRect,
    video,
    confidenceThreshold
  );

  if (colorResult) {
    return {
      color: colorResult.color,
      confidence: colorResult.confidence,
      distance: closestCandidate.distance
    };
  }

  return null;
};
