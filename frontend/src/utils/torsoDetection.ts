import * as poseDetection from "@tensorflow-models/pose-detection";
import Webcam from "react-webcam";
import { Coordinate } from './types';
import { categorizeColor, analyzeImageData } from './colorDetection';

export const extractTorsoBox = (
  pose: poseDetection.Pose,
  confidenceThreshold: number = 0.3,
): Coordinate[] | null => {
  // Validate inputs
  if (!pose || !pose.keypoints || pose.keypoints.length === 0) {
    return null;
  }

  const coreBodyKeypointNames = [
    'left_shoulder', 'right_shoulder',
    'left_hip', 'right_hip',
  ];

  const validBodyKeypoints = pose.keypoints.filter(keypoint => 
    keypoint &&
    keypoint.name && 
    coreBodyKeypointNames.includes(keypoint.name) &&
    keypoint.score && 
    keypoint.score > confidenceThreshold &&
    typeof keypoint.x === 'number' && typeof keypoint.y === 'number' &&
    isFinite(keypoint.x) && isFinite(keypoint.y) && // Ensure coordinates are finite
    keypoint.x >= 0 && keypoint.y >= 0 // Ensure coordinates are non-negative
  );

  // Need at least 3 valid keypoints for a meaningful torso box
  if (validBodyKeypoints.length < 3) {
    return null;
  }

  const result: Coordinate[] = [
    {x: 0, y: 0},
    {x: 0, y: 0},
    {x: 0, y: 0},
    {x: 0, y: 0}
  ];

  validBodyKeypoints.forEach(kp => {
    switch (kp.name) {
      case "left_shoulder":
        result[0] = {x: kp.x, y: kp.y};
        break;
      case "right_shoulder":
        result[1] = {x: kp.x, y: kp.y};
        break;
      case "right_hip":
        result[2] = {x: kp.x, y: kp.y};
        break;
      case "left_hip":
        result[3] = {x: kp.x, y: kp.y};
        break;
    }
  });

  const average: Coordinate = {x: 0, y: 0};
  let count = 0;

  result.forEach(point => {
    if (point.x !== 0 && point.y !== 0) {
      average.x += point.x;
      average.y += point.y;
      count++;
    }
  });

  if (count > 0) {
    average.x /= count;
    average.y /= count;

    for (let index = 0; index < result.length; index++) {
      const element = result[index];
      
      if (element.x === 0 && element.y === 0) {
        result[index] = average;
      }
    }
  }

  return result;
};

export const drawTorsoBox = (
  pose: poseDetection.Pose,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  webcamRef: React.RefObject<Webcam | null>,
  confidenceThreshold: number = 0.3
): {r: number, g: number, b: number} | null => {
  // Validate inputs
  if (!pose || !pose.keypoints) {
    console.warn("Invalid pose data provided to drawTorsoBox");
    return null;
  }

  const ctx = canvasRef.current?.getContext("2d");
  const video = webcamRef.current?.video;

  if (!ctx || !video) {
    console.error("Canvas or video not ready for bounding box");
    return null;
  }

  const canvas = canvasRef.current;
  if (!canvas) return null;

  // Get scaling factors with validation
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const displayWidth = video.clientWidth;
  const displayHeight = video.clientHeight;

  // Validate video dimensions
  if (!videoWidth || !videoHeight || !displayWidth || !displayHeight) {
    console.warn("Invalid video dimensions:", { videoWidth, videoHeight, displayWidth, displayHeight });
    return null;
  }

  if (!isFinite(videoWidth) || !isFinite(videoHeight) || !isFinite(displayWidth) || !isFinite(displayHeight)) {
    console.warn("Non-finite video dimensions:", { videoWidth, videoHeight, displayWidth, displayHeight });
    return null;
  }

  const scaleX = displayWidth / videoWidth;
  const scaleY = displayHeight / videoHeight;

  // Calculate scaling factors accounting for objectFit: 'cover'
  const videoAspectRatio = videoWidth / videoHeight;
  const displayAspectRatio = displayWidth / displayHeight;
  
  let actualScaleX: number, actualScaleY: number;
  let offsetX: number = 0, offsetY: number = 0;
  
  if (videoAspectRatio > displayAspectRatio) {
    // Video is wider than display - video will be scaled by height and cropped horizontally
    const scale = displayHeight / videoHeight;
    actualScaleX = scale;
    actualScaleY = scale;
    offsetX = (displayWidth - videoWidth * scale) / 2;
  } else {
    // Video is taller than display - video will be scaled by width and cropped vertically  
    const scale = displayWidth / videoWidth;
    actualScaleX = scale;
    actualScaleY = scale;
    offsetY = (displayHeight - videoHeight * scale) / 2;
  }

  // Extract body bounding box
  const boundingBox = extractTorsoBox(pose, confidenceThreshold);
  
  if (boundingBox) {
    // Scale bounding box to display coordinates
    ctx.strokeStyle = "rgba(230, 0, 255, 0.9)"; // Purple outline
    ctx.lineWidth = 2;
    for (let index = 0; index < 4; index++) {
      const coord1 = boundingBox[index];
      const coord2 = boundingBox[(index+1) % 4];

      const scaledX1 = coord1.x * actualScaleX + offsetX;
      const scaledX2 = coord2.x * actualScaleX + offsetX;

      const scaledY1 = coord1.y * actualScaleY + offsetY;
      const scaledY2 = coord2.y * actualScaleY + offsetY;
      
      ctx.beginPath();
      ctx.moveTo(scaledX1, scaledY1);
      ctx.lineTo(scaledX2, scaledY2);
      ctx.stroke();
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Safely extract bounds with validation
  try {
    boundingBox?.forEach(point => {
      // Validate point coordinates are finite numbers
      if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
        console.warn("Invalid point in bounding box:", point);
        return;
      }
      
      if (!isFinite(point.x) || !isFinite(point.y)) {
        console.warn("Non-finite coordinates in bounding box:", point);
        return;
      }
      
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    });
  } catch (error) {
    console.error("Error processing bounding box coordinates:", error);
    return null;
  }

  if (minX === Infinity || minY === Infinity || 
      maxX === -Infinity || maxY === -Infinity) {
    return null;
  }

  // Additional validation for reasonable coordinate ranges
  if (minX < 0 || minY < 0 || maxX > videoWidth || maxY > videoHeight) {
    console.warn("Bounding box coordinates outside video bounds:", { minX, minY, maxX, maxY, videoWidth, videoHeight });
    // Clamp to video bounds rather than returning null
    minX = Math.max(0, minX);
    minY = Math.max(0, minY);
    maxX = Math.min(videoWidth, maxX);
    maxY = Math.min(videoHeight, maxY);
  }

  // Validate scaling factors are finite
  if (!isFinite(actualScaleX) || !isFinite(actualScaleY) || actualScaleX <= 0 || actualScaleY <= 0) {
    console.error("Invalid scaling factors:", { actualScaleX, actualScaleY, displayWidth, displayHeight, videoWidth, videoHeight });
    return null;
  }

  const scaledX1 = minX * actualScaleX + offsetX;
  const scaledX2 = maxX * actualScaleX + offsetX;

  const scaledY1 = minY * actualScaleY + offsetY;
  const scaledY2 = maxY * actualScaleY + offsetY;
  
  let w = scaledX2-scaledX1;
  let h = scaledY2-scaledY1;

  // Validate calculated dimensions are finite
  if (!isFinite(w) || !isFinite(h)) {
    console.error("Invalid calculated dimensions:", { w, h, scaledX1, scaledX2, scaledY1, scaledY2 });
    return null;
  }

  const MIN_WIDTH = 20;
  const MIN_HEIGHT = 20;

  const diffW = MIN_WIDTH - w;
  const diffH = MIN_HEIGHT - h;

  let x = scaledX1;
  let y = scaledY1;
  
  if (diffW>0) {
    x -= diffW/2;
    w = MIN_WIDTH;
  }

  if (diffH>0) {
    y -= diffH/2;
    h = MIN_HEIGHT;
  }

  // Create a temporary canvas to capture the current video frame
  if (typeof document === 'undefined') {
    console.error("Document not available (SSR environment)");
    return null;
  }
  
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');

  if (!tempCtx) {
    console.error("Could not create temporary canvas.");
    return null;
  }

  // Set temp canvas to video dimensions
  tempCanvas.width = Math.round(videoWidth);
  tempCanvas.height = Math.round(videoHeight);

  // Draw the current video frame to temp canvas
  tempCtx.drawImage(video, 0, 0, videoWidth, videoHeight);

  // Calculate the region to sample from (in original video coordinates, not scaled)
  const sampleX = Math.max(0, Math.min(Math.round(minX - (diffW > 0 ? diffW/2/scaleX : 0)), videoWidth));
  const sampleY = Math.max(0, Math.min(Math.round(minY - (diffH > 0 ? diffH/2/scaleY : 0)), videoHeight));
  const sampleW = Math.max(1, Math.min(Math.round(w/scaleX), videoWidth - sampleX));
  const sampleH = Math.max(1, Math.min(Math.round(h/scaleY), videoHeight - sampleY));

  // Validate all values are finite numbers before calling getImageData
  if (!isFinite(sampleX) || !isFinite(sampleY) || !isFinite(sampleW) || !isFinite(sampleH)) {
    console.error("Invalid sample coordinates:", { sampleX, sampleY, sampleW, sampleH });
    return null;
  }

  if (sampleW <= 0 || sampleH <= 0) {
    console.error("Invalid sample dimensions:", { sampleW, sampleH });
    return null;
  }

  // Get image data from the video frame (not the overlay canvas)
  const data: ImageData = tempCtx.getImageData(sampleX, sampleY, sampleW, sampleH);

  const rgb = {r: 0, g: 0, b: 0};
  
  // Calculate average RGB with better filtering
  const blockSize = 4; // Sample every 4th pixel for efficiency
  const rgbSamples: number[] = [];
  for (let i = 0; i < data.data.length; i += blockSize * 4) {
    const r = data.data[i];
    const g = data.data[i + 1];
    const b = data.data[i + 2];
    const a = data.data[i + 3];
    
    // Skip transparent pixels and extreme values
    if (a < 200) continue;
    const brightness = (r + g + b) / 3;
    if (brightness < 20 || brightness > 235) continue;
    
    rgbSamples.push(r, g, b);
  }

  // Calculate average from filtered samples
  if (rgbSamples.length > 0) {
    let sumR = 0, sumG = 0, sumB = 0;
    const numSamples = rgbSamples.length / 3;
    
    for (let i = 0; i < rgbSamples.length; i += 3) {
      sumR += rgbSamples[i];
      sumG += rgbSamples[i + 1];
      sumB += rgbSamples[i + 2];
    }
    
    rgb.r = Math.floor(sumR / numSamples);
    rgb.g = Math.floor(sumG / numSamples);
    rgb.b = Math.floor(sumB / numSamples);
  }

  const rgba = `rgba(${rgb.r},${rgb.g},${rgb.b},1)`;
  const detectedColor = categorizeColor(rgb.r, rgb.g, rgb.b);

  // Draw the average color rectangle
  ctx.beginPath();
  ctx.fillStyle = rgba;
  ctx.fillRect(x, y, w, h);

  // Add text overlay showing RGB values and detected color
  if (rgb.r > 0 || rgb.g > 0 || rgb.b > 0) {
    // Background for text
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(x, y + h + 5, Math.max(w, 120), 40);
    
    // RGB values
    ctx.fillStyle = "white";
    ctx.font = "10px Arial";
    ctx.fillText(`RGB: ${rgb.r}, ${rgb.g}, ${rgb.b}`, x + 2, y + h + 18);
    ctx.fillText(`Color: ${detectedColor}`, x + 2, y + h + 32);
  }

  return rgb;
};

export const extractTorsoColor = (
  pose: poseDetection.Pose,
  video: HTMLVideoElement,
  confidenceThreshold: number = 0.3
): {color: string, confidence: number} | null => {
  if (!pose.keypoints || pose.keypoints.length === 0) {
    return null;
  }

  const coreBodyKeypointNames = [
    'left_shoulder', 'right_shoulder',
    'left_hip', 'right_hip',
  ];

  const validBodyKeypoints = pose.keypoints.filter(keypoint => 
    keypoint.name && 
    coreBodyKeypointNames.includes(keypoint.name) &&
    keypoint.score && 
    keypoint.score > confidenceThreshold &&
    isFinite(keypoint.x) && isFinite(keypoint.y) // Ensure coordinates are finite
  );

  if (validBodyKeypoints.length < 3) {
    return null;
  }

  // Create a temporary canvas to capture the current video frame
  if (typeof document === 'undefined') {
    console.error("Document not available (SSR environment)");
    return null;
  }
  
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');

  if (!tempCtx) {
    console.error("Could not create temporary canvas for color extraction.");
    return null;
  }

  // Set temp canvas to video dimensions
  tempCanvas.width = Math.round(video.videoWidth);
  tempCanvas.height = Math.round(video.videoHeight);

  // Draw the current video frame to temp canvas (clean video without overlays)
  try {
    tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
  } catch (error) {
    console.error("Error drawing video to temporary canvas:", error);
    return null;
  }

  // Find torso bounding box with improved accuracy
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Calculate center point first to help with outlier detection
  const centerX = validBodyKeypoints.reduce((sum, kp) => sum + kp.x, 0) / validBodyKeypoints.length;
  const centerY = validBodyKeypoints.reduce((sum, kp) => sum + kp.y, 0) / validBodyKeypoints.length;

  // Filter out any obvious outlier keypoints that might be misdetected
  const filteredKeypoints = validBodyKeypoints.filter(kp => {
    const distanceFromCenter = Math.sqrt(Math.pow(kp.x - centerX, 2) + Math.pow(kp.y - centerY, 2));
    // Remove keypoints that are too far from the center (likely false detections)
    return distanceFromCenter < 200; // Adjust threshold as needed
  });

  // Use filtered keypoints to calculate bounds
  filteredKeypoints.forEach(keypoint => {
    if (keypoint.x < minX) minX = keypoint.x;
    if (keypoint.x > maxX) maxX = keypoint.x;
    if (keypoint.y < minY) minY = keypoint.y;
    if (keypoint.y > maxY) maxY = keypoint.y;
  });

  // Validate that we found valid bounds
  if (minX === Infinity || maxX === -Infinity || minY === Infinity || maxY === -Infinity) {
    console.error("Could not determine valid torso bounds");
    return null;
  }

  // Calculate torso region more intelligently
  const torsoWidth = maxX - minX;
  const torsoHeight = maxY - minY;
  
  // Focus on the center-chest area for more accurate color detection
  // Reduce the sampling area to avoid arms and edges
  const horizontalInset = torsoWidth * 0.25;  // Remove 25% from each side
  const verticalInset = torsoHeight * 0.15;   // Remove 15% from top and bottom
  
  // Calculate the focused sampling region
  const focusedMinX = minX + horizontalInset;
  const focusedMaxX = maxX - horizontalInset;
  const focusedMinY = minY + verticalInset;
  const focusedMaxY = maxY - verticalInset;

  // Ensure we still have a meaningful region
  if (focusedMaxX <= focusedMinX || focusedMaxY <= focusedMinY) {
    console.warn("Focused region too small, using original bounds");
    // Fall back to original bounds with minimal padding
    const padding = 5;
    const x = Math.max(0, Math.round(minX - padding));
    const y = Math.max(0, Math.round(minY - padding));
    const width = Math.max(1, Math.min(Math.round(maxX - minX + 2 * padding), video.videoWidth - x));
    const height = Math.max(1, Math.min(Math.round(maxY - minY + 2 * padding), video.videoHeight - y));
    
    if (width > 0 && height > 0) {
      const data: ImageData = tempCtx.getImageData(x, y, width, height);
      return analyzeImageData(data);
    }
    return null;
  }

  // Use the focused region for color sampling
  const padding = 8;
  const x = Math.max(0, Math.round(focusedMinX - padding));
  const y = Math.max(0, Math.round(focusedMinY - padding));
  const width = Math.max(1, Math.min(Math.round(focusedMaxX - focusedMinX + 2 * padding), video.videoWidth - x));
  const height = Math.max(1, Math.min(Math.round(focusedMaxY - focusedMinY + 2 * padding), video.videoHeight - y));

  // Validate all coordinates and dimensions are finite and valid
  if (!isFinite(x) || !isFinite(y) || !isFinite(width) || !isFinite(height)) {
    console.error("Invalid torso extraction coordinates:", { x, y, width, height, focusedMinX, focusedMaxX, focusedMinY, focusedMaxY });
    return null;
  }

  if (width <= 0 || height <= 0) {
    console.error("Invalid torso extraction dimensions:", { width, height });
    return null;
  }

  // Get image data from the focused torso region
  const data: ImageData = tempCtx.getImageData(x, y, width, height);
  
  // Use the improved analysis function
  return analyzeImageData(data);
};

// Helper function to extract torso rectangle bounds
export const extractTorsoRectangle = (
  pose: poseDetection.Pose,
  confidenceThreshold: number = 0.3
): { minX: number; maxX: number; minY: number; maxY: number } | null => {
  // Get the torso box coordinates
  const boundingBox = extractTorsoBox(pose, confidenceThreshold);
  
  if (!boundingBox) {
    return null;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Extract bounds from the torso box points
  boundingBox.forEach(point => {
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
      return;
    }
    
    if (!isFinite(point.x) || !isFinite(point.y)) {
      return;
    }
    
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  });

  if (minX === Infinity || minY === Infinity || 
      maxX === -Infinity || maxY === -Infinity) {
    return null;
  }

  return { minX, maxX, minY, maxY };
};

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

// Helper function to extract color from a specific torso rectangle
export const extractTorsoColorFromRect = (
  torsoRect: { minX: number; maxX: number; minY: number; maxY: number },
  video: HTMLVideoElement,
  confidenceThreshold: number = 0.3
): { color: string; confidence: number } | null => {
  // Create a temporary canvas to capture the current video frame
  if (typeof document === 'undefined') {
    console.error("Document not available (SSR environment)");
    return null;
  }
  
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');

  if (!tempCtx) {
    console.error("Could not create temporary canvas for color extraction.");
    return null;
  }

  // Set temp canvas to video dimensions
  tempCanvas.width = Math.round(video.videoWidth);
  tempCanvas.height = Math.round(video.videoHeight);

  // Draw the current video frame to temp canvas (clean video without overlays)
  try {
    tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
  } catch (error) {
    console.error("Error drawing video to temporary canvas:", error);
    return null;
  }

  // Clamp rectangle bounds to video dimensions
  const minX = Math.max(0, torsoRect.minX);
  const minY = Math.max(0, torsoRect.minY);
  const maxX = Math.min(video.videoWidth, torsoRect.maxX);
  const maxY = Math.min(video.videoHeight, torsoRect.maxY);

  // Apply minimum size constraints
  const MIN_WIDTH = 20;
  const MIN_HEIGHT = 20;
  
  let rectWidth = maxX - minX;
  let rectHeight = maxY - minY;
  let rectX = minX;
  let rectY = minY;

  const diffW = MIN_WIDTH - rectWidth;
  const diffH = MIN_HEIGHT - rectHeight;

  if (diffW > 0) {
    rectX -= diffW / 2;
    rectWidth = MIN_WIDTH;
  }

  if (diffH > 0) {
    rectY -= diffH / 2;
    rectHeight = MIN_HEIGHT;
  }

  // Ensure we don't go outside video bounds
  rectX = Math.max(0, Math.min(rectX, video.videoWidth - rectWidth));
  rectY = Math.max(0, Math.min(rectY, video.videoHeight - rectHeight));
  rectWidth = Math.max(1, Math.min(rectWidth, video.videoWidth - rectX));
  rectHeight = Math.max(1, Math.min(rectHeight, video.videoHeight - rectY));

  // Validate all values are finite numbers before calling getImageData
  if (!isFinite(rectX) || !isFinite(rectY) || !isFinite(rectWidth) || !isFinite(rectHeight)) {
    console.error("Invalid rect coordinates:", { rectX, rectY, rectWidth, rectHeight });
    return null;
  }

  if (rectWidth <= 0 || rectHeight <= 0) {
    console.error("Invalid rect dimensions:", { rectWidth, rectHeight });
    return null;
  }

  // Get image data from the torso rectangle
  const data: ImageData = tempCtx.getImageData(
    Math.round(rectX), 
    Math.round(rectY), 
    Math.round(rectWidth), 
    Math.round(rectHeight)
  );
  
  // Use the existing analysis function
  return analyzeImageData(data);
};
