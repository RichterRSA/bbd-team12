import * as poseDetection from "@tensorflow-models/pose-detection";
import Webcam from "react-webcam";
import { drawTorsoBox, extractBodyBoundingBox } from './torsoDetection';
import { isPersonInCrosshair, drawCrosshair, getCrosshairTorsoColor } from './crosshairUtils';

export function drawDetections(
  detections: poseDetection.Pose[], 
  canvasRef: React.RefObject<HTMLCanvasElement | null>, 
  webcamRef: React.RefObject<Webcam | null>,
  highFpsMode: boolean = true,
  crosshairRadius: number = 60 // Reduced from 80 for easier targeting
) {
  // Validate inputs
  if (!detections || !Array.isArray(detections)) {
    console.warn("Invalid detections array provided to drawDetections");
    return;
  }

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

  // Validate dimensions
  if (!videoWidth || !videoHeight || !displayWidth || !displayHeight) {
    return;
  }

  if (!isFinite(videoWidth) || !isFinite(videoHeight) || !isFinite(displayWidth) || !isFinite(displayHeight)) {
    return;
  }

  // Set canvas size to match the displayed video
  canvas.width = displayWidth;
  canvas.height = displayHeight;

  // Calculate scaling factors accounting for objectFit: 'cover'
  // With 'cover', the video is scaled to fill the container while maintaining aspect ratio
  const videoAspectRatio = videoWidth / videoHeight;
  const displayAspectRatio = displayWidth / displayHeight;
  
  let scaleX: number, scaleY: number;
  let offsetX: number = 0, offsetY: number = 0;
  
  if (videoAspectRatio > displayAspectRatio) {
    // Video is wider than display - video will be scaled by height and cropped horizontally
    const scale = displayHeight / videoHeight;
    scaleX = scale;
    scaleY = scale;
    offsetX = (displayWidth - videoWidth * scale) / 2;
  } else {
    // Video is taller than display - video will be scaled by width and cropped vertically  
    const scale = displayWidth / videoWidth;
    scaleX = scale;
    scaleY = scale;
    offsetY = (displayHeight - videoHeight * scale) / 2;
  }

  // Validate scaling factors
  if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    console.error("Invalid scaling factors in drawDetections:", { scaleX, scaleY });
    return;
  }

  // Clear previous drawings
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Use a much lower confidence threshold in high FPS mode (60fps)
  const confidenceThreshold = highFpsMode ? 0.15 : 0.2;
  
  // Draw all detected poses
  detections.forEach((pose, index) => {
    try {
      if (!pose || !pose.keypoints || pose.keypoints.length === 0) {
        return;
      }
      
      const keypoints: poseDetection.Keypoint[] = pose.keypoints;
    
    // Draw connections (skeleton) - optimized for high framerates
    ctx.strokeStyle = "rgba(0, 128, 255, 0.9)"; // Semi-transparent blue
    ctx.lineWidth = 3;     

  // Draw keypoints - optimized for high framerates
  // keypoints.forEach(keypoint => {
  //   if (keypoint.score && keypoint.score > confidenceThreshold) {
  //     // Validate keypoint coordinates
  //     if (!isFinite(keypoint.x) || !isFinite(keypoint.y)) {
  //       console.warn("Non-finite keypoint coordinates:", keypoint);
  //       return;
  //     }

  //     const x = keypoint.x;
  //     const y = keypoint.y;

  //     // Scale the coordinates to match the displayed video size with objectFit: 'cover' accounting
  //     const scaledX = x * scaleX + offsetX;
  //     const scaledY = y * scaleY + offsetY;

  //     // Validate scaled coordinates
  //     if (!isFinite(scaledX) || !isFinite(scaledY)) {
  //       console.warn("Non-finite scaled coordinates:", { scaledX, scaledY, x, y, scaleX, scaleY });
  //       return;
  //     }

  //     // Draw filled circle for each keypoint
  //     ctx.fillStyle = "rgba(255, 0, 0, 0.9)"; // Semi-transparent red
  //     ctx.beginPath();
  //     ctx.arc(scaledX, scaledY, 4, 0, 2 * Math.PI);
  //     ctx.fill();
  //   }
  // });

    // Draw the torso box with error handling
    try {
      drawTorsoBox(pose, canvasRef, webcamRef, confidenceThreshold);
    } catch (error) {
      console.error("Error drawing torso box:", error);
      // Continue processing other poses even if one fails
    }
    } catch (error) {
      console.error(`Error processing pose ${index}:`, error);
      // Continue with next pose
    }
  }); 

  var inCenter = false;
  detections.forEach(element => {
    if (isPersonInCrosshair(element, videoWidth, videoHeight, crosshairRadius)) {
      inCenter = true;
    }
  });
  const col = getCrosshairTorsoColor(detections, webcamRef, videoWidth, videoHeight, crosshairRadius);

  drawCrosshair(canvasRef, webcamRef, crosshairRadius, inCenter, col ? col.color : "rgba(255, 255, 255, 0.6)");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const drawBodyBoundingBox = (
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