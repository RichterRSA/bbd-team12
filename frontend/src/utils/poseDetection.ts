import * as poseDetection from "@tensorflow-models/pose-detection";
import Webcam from "react-webcam";

export interface Coordinate {
  x: number;
  y: number;
}

export const isMobileDevice = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false; // Default to false during SSR
  }
  
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
};

export async function requestCameraPermission(showNotification?: (message: string, type: 'success' | 'info' | 'error') => void): Promise<boolean> {
  try {
    // First check if camera is available
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    
    if (videoDevices.length === 0) {
      console.error('No video input devices found');
      return false;
    }

    const isMobile = isMobileDevice();
    
    // Try with device-specific constraints first
    const idealConstraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: isMobile ? { ideal: "environment" } : { ideal: "user" }
      }
    };
    
    console.log(`Requesting camera for ${isMobile ? 'mobile' : 'desktop'} device with facingMode: ${isMobile ? 'environment' : 'user'}`);
    
    const stream = await navigator.mediaDevices.getUserMedia(idealConstraints);
    
    // Test that we can actually use the stream
    stream.getTracks().forEach(track => track.stop());
    
    return true;
  } catch (error) {
    console.error('Primary camera request failed:', error);
    
    // Check if it's an allocation error (camera in use)
    if (error instanceof DOMException && error.message.includes('Failed to allocate videosource')) {
      console.warn('Camera appears to be in use by another application or tab');
      if (showNotification) {
        showNotification('Camera is in use by another application. Please close other camera apps and try again.', 'error');
      }
      return false;
    }
    
    // Try fallback with any available camera
    try {
      const fallbackConstraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      };
      
      console.log('Trying fallback camera constraints without facingMode');
      const fallbackStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      fallbackStream.getTracks().forEach(track => track.stop());
      return true;
    } catch (fallbackError) {
      console.error('Fallback camera access also failed:', fallbackError);
      
      // Final fallback - most basic constraints
      try {
        console.log('Trying most basic camera constraints');
        const basicStream = await navigator.mediaDevices.getUserMedia({ video: true });
        basicStream.getTracks().forEach(track => track.stop());
        return true;
      } catch (basicError) {
        console.error('All camera access attempts failed:', basicError);
        return false;
      }
    }
  }
}

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

  // Extract body bounding box
  const boundingBox = extractTorsoBox(pose, confidenceThreshold);
  
  if (boundingBox) {
    // Scale bounding box to display coordinates
    ctx.strokeStyle = "rgba(230, 0, 255, 0.9)"; // Purple outline
    ctx.lineWidth = 2;
    for (let index = 0; index < 4; index++) {
      const coord1 = boundingBox[index];
      const coord2 = boundingBox[(index+1) % 4];

      const scaledX1 = coord1.x * scaleX;
      const scaledX2 = coord2.x * scaleX;

      const scaledY1 = coord1.y * scaleY;
      const scaledY2 = coord2.y * scaleY;
      
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
    console.warn("Could not determine valid bounding box bounds");
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
  if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    console.error("Invalid scaling factors:", { scaleX, scaleY, displayWidth, displayHeight, videoWidth, videoHeight });
    return null;
  }

  const scaledX1 = minX * scaleX;
  const scaledX2 = maxX * scaleX;

  const scaledY1 = minY * scaleY;
  const scaledY2 = maxY * scaleY;
  
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

// Helper function to convert RGB to HSV for better color analysis
const rgbToHsv = (r: number, g: number, b: number): { h: number; s: number; v: number } => {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s: s * 100, v: v * 100 };
};

// Helper function to normalize lighting in RGB values (more conservative)
const normalizeLighting = (r: number, g: number, b: number): { r: number; g: number; b: number } => {
  // Convert to HSV to manipulate brightness independently
  const { h, s, v } = rgbToHsv(r, g, b);
  
  // More conservative brightness normalization
  let normalizedV = v;
  
  // Only slightly boost very dark colors
  if (v < 25) {
    normalizedV = Math.min(v * 1.3, 40);
  }
  // Only slightly reduce very bright colors
  else if (v > 90) {
    normalizedV = Math.max(v * 0.95, 85);
  }
  // Leave mid-range values mostly alone
  else {
    normalizedV = Math.min(v * 1.05, 95);
  }
  
  // Convert back to RGB
  const hNorm = h / 60;
  const sNorm = s / 100;
  const vNorm = normalizedV / 100;
  
  const c = vNorm * sNorm;
  const x = c * (1 - Math.abs((hNorm % 2) - 1));
  const m = vNorm - c;
  
  let rPrime = 0, gPrime = 0, bPrime = 0;
  
  if (hNorm >= 0 && hNorm < 1) {
    rPrime = c; gPrime = x; bPrime = 0;
  } else if (hNorm >= 1 && hNorm < 2) {
    rPrime = x; gPrime = c; bPrime = 0;
  } else if (hNorm >= 2 && hNorm < 3) {
    rPrime = 0; gPrime = c; bPrime = x;
  } else if (hNorm >= 3 && hNorm < 4) {
    rPrime = 0; gPrime = x; bPrime = c;
  } else if (hNorm >= 4 && hNorm < 5) {
    rPrime = x; gPrime = 0; bPrime = c;
  } else if (hNorm >= 5 && hNorm < 6) {
    rPrime = c; gPrime = 0; bPrime = x;
  }
  
  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255)
  };
};

export const categorizeColor = (r: number, g: number, b: number): string => {
  // Convert to HSV for better color classification
  const { h, s, v } = rgbToHsv(r, g, b);
  
  // More conservative grayscale detection
  if (s < 15) {
    if (v < 25) return 'black';
    if (v > 80) return 'white';
    if (v < 45) return 'black';  // Dark gray -> black
    if (v > 60) return 'white';  // Light gray -> white
    return 'gray';
  }
  
  // Handle very dark colors
  if (v < 25) return 'black';
  
  // Handle very light colors with low saturation
  if (v > 85 && s < 30) return 'white';
  if (v > 78 && s < 20) return 'white';
  
  // More conservative red detection to avoid false positives from pose dots
  if ((h >= 0 && h <= 12) || (h >= 348 && h <= 359)) {
    // Require higher saturation for red to avoid picking up red overlay graphics
    if (s > 35 && v > 30) return 'red';
    // If low saturation, might be pink or gray
    if (v > 60) return 'pink';
    return 'gray';
  }
  
  // Orange spectrum (more conservative)
  if (h >= 13 && h <= 35) {
    if (s > 40) return 'orange';
    if (v > 70) return 'yellow'; // Light orange might be yellow
    return 'gray';
  }
  
  // Yellow spectrum
  if (h >= 36 && h <= 70) {
    if (s > 25) return 'yellow';
    return 'gray';
  }
  
  // Green spectrum
  if (h >= 71 && h <= 160) {
    if (s > 20) return 'green';
    return 'gray';
  }
  
  // Blue spectrum
  if (h >= 161 && h <= 230) {
    if (s > 25) return 'blue';
    return 'gray';
  }
  
  // Purple spectrum
  if (h >= 231 && h <= 280) {
    if (s > 30) return 'purple';
    return 'gray';
  }
  
  // Pink/Magenta spectrum
  if (h >= 281 && h <= 347) {
    if (v > 50 && s > 20) return 'pink';
    if (s > 50) return 'purple';
    return 'gray';
  }
  
  // Default fallback - be more conservative
  if (s < 25) return 'gray';
  if (v < 30) return 'black';
  if (v > 85) return 'white';
  
  return 'gray';
};

export function drawDetections(
  detections: poseDetection.Pose[], 
  canvasRef: React.RefObject<HTMLCanvasElement | null>, 
  webcamRef: React.RefObject<Webcam | null>,
  highFpsMode: boolean = true
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
    console.warn("Invalid video dimensions in drawDetections:", { videoWidth, videoHeight, displayWidth, displayHeight });
    return;
  }

  if (!isFinite(videoWidth) || !isFinite(videoHeight) || !isFinite(displayWidth) || !isFinite(displayHeight)) {
    console.warn("Non-finite video dimensions in drawDetections:", { videoWidth, videoHeight, displayWidth, displayHeight });
    return;
  }

  // Set canvas size to match the displayed video
  canvas.width = displayWidth;
  canvas.height = displayHeight;

  // Calculate scaling factors
  const scaleX = displayWidth / videoWidth;
  const scaleY = displayHeight / videoHeight;

  // Validate scaling factors
  if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    console.error("Invalid scaling factors in drawDetections:", { scaleX, scaleY });
    return;
  }

  // Clear previous drawings
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Use a much lower confidence threshold in high FPS mode (60fps)
  const confidenceThreshold = highFpsMode ? 0.1 : 0.5;
  
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
    keypoints.forEach(keypoint => {
      if (keypoint.score && keypoint.score > confidenceThreshold) {
        // Validate keypoint coordinates
        if (!isFinite(keypoint.x) || !isFinite(keypoint.y)) {
          console.warn("Non-finite keypoint coordinates:", keypoint);
          return;
        }

        const x = keypoint.x;
        const y = keypoint.y;

        // Scale the coordinates to match the displayed video size
        const scaledX = x * scaleX;
        const scaledY = y * scaleY;

        // Validate scaled coordinates
        if (!isFinite(scaledX) || !isFinite(scaledY)) {
          console.warn("Non-finite scaled coordinates:", { scaledX, scaledY, x, y, scaleX, scaleY });
          return;
        }

        // Draw filled circle for each keypoint
        ctx.fillStyle = "rgba(255, 0, 0, 0.9)"; // Semi-transparent red
        ctx.beginPath();
        ctx.arc(scaledX, scaledY, 4, 0, 2 * Math.PI);
        ctx.fill();
      }
    });

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
}

// Helper function to analyze image data for color detection
const analyzeImageData = (data: ImageData): {color: string, confidence: number} | null => {
  // Improved color analysis with better filtering and statistical approach
  const colorCounts: { [key: string]: number } = {};
  const rgbSamples: { r: number; g: number; b: number }[] = [];
  const pixels = data.data;

  // First pass: collect valid color samples with more sophisticated filtering
  for (let i = 0; i < pixels.length; i += 16) { // Sample every 4th pixel for better performance
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3]; // Alpha channel
    
    // Skip transparent or very transparent pixels
    if (a < 220) continue;
    
    // Filter out likely overlay graphics (bright red dots from pose detection)
    // Check for bright red pixels that are likely from the pose overlay
    if (r > 200 && g < 100 && b < 100) {
      // This looks like a bright red overlay dot, skip it
      continue;
    }
    
    // Also filter out other bright, highly saturated colors that might be overlays
    const maxComponent = Math.max(r, g, b);
    const minComponent = Math.min(r, g, b);
    const componentDiff = maxComponent - minComponent;
    
    // If one color component is much higher than others, it might be an overlay
    if (maxComponent > 220 && componentDiff > 150) {
      continue;
    }
    
    // Calculate various color properties for better filtering
    const brightness = (r + g + b) / 3;
    const maxRgb = Math.max(r, g, b);
    const minRgb = Math.min(r, g, b);
    const saturation = maxRgb === 0 ? 0 : (maxRgb - minRgb) / maxRgb;
    const contrast = maxRgb - minRgb;
    
    // More sophisticated filtering to avoid lighting artifacts:
    
    // 1. Skip extreme brightness values (overexposed/underexposed areas)
    if (brightness < 30 || brightness > 220) continue;
    
    // 2. Skip pixels with very low contrast (flat lighting areas)
    if (contrast < 20 && brightness > 60 && brightness < 180) continue;
    
    // 3. For very bright areas, require higher saturation to avoid white balance issues
    if (brightness > 170 && saturation < 0.2) continue;
    
    // 4. For darker areas, be more lenient with saturation (dark clothing can appear desaturated)
    if (brightness < 90 && saturation < 0.08 && contrast < 15) continue;
    
    // 5. Skip obvious shadow areas (low brightness with low saturation)
    if (brightness < 50 && saturation < 0.15) continue;
    
    // 6. Skip obvious highlight areas (very bright with low saturation)
    if (brightness > 190 && saturation < 0.25) continue;
    
    rgbSamples.push({ r, g, b });
  }

  // If we don't have enough samples, try with more lenient filtering
  if (rgbSamples.length < 20) {
    rgbSamples.length = 0; // Clear array
    for (let i = 0; i < pixels.length; i += 12) { // Denser sampling
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      
      if (a < 180) continue;
      const brightness = (r + g + b) / 3;
      const maxRgb = Math.max(r, g, b);
      const minRgb = Math.min(r, g, b);
      const contrast = maxRgb - minRgb;
      
      // More lenient filtering for difficult lighting conditions
      if (brightness < 20 || brightness > 240) continue;
      if (contrast < 8 && brightness > 60 && brightness < 180) continue;
      
      rgbSamples.push({ r, g, b });
    }
  }

  // Apply statistical filtering to remove outliers
  if (rgbSamples.length > 10) {
    // Calculate median RGB values to identify outliers
    const rValues = rgbSamples.map(s => s.r).sort((a, b) => a - b);
    const gValues = rgbSamples.map(s => s.g).sort((a, b) => a - b);
    const bValues = rgbSamples.map(s => s.b).sort((a, b) => a - b);
    
    const medianR = rValues[Math.floor(rValues.length / 2)];
    const medianG = gValues[Math.floor(gValues.length / 2)];
    const medianB = bValues[Math.floor(bValues.length / 2)];
    
    // Filter out samples that are too far from the median (outliers)
    const filteredSamples = rgbSamples.filter(sample => {
      const rDiff = Math.abs(sample.r - medianR);
      const gDiff = Math.abs(sample.g - medianG);
      const bDiff = Math.abs(sample.b - medianB);
      const totalDiff = rDiff + gDiff + bDiff;
      
      // Allow more variation for darker colors, less for lighter colors
      const brightness = (sample.r + sample.g + sample.b) / 3;
      const tolerance = brightness < 100 ? 80 : 60;
      
      return totalDiff < tolerance;
    });
    
    // Use filtered samples if we still have enough data
    if (filteredSamples.length >= Math.min(10, rgbSamples.length * 0.3)) {
      rgbSamples.length = 0;
      rgbSamples.push(...filteredSamples);
    }
  }

  // Categorize each sample with weighted voting and lighting normalization
  const colorVotes: { [key: string]: { count: number; confidence: number } } = {};
  
  rgbSamples.forEach(sample => {
    // Apply conservative lighting normalization for better color detection
    const normalized = normalizeLighting(sample.r, sample.g, sample.b);
    const { h, s, v } = rgbToHsv(normalized.r, normalized.g, normalized.b);
    const color = categorizeColor(normalized.r, normalized.g, normalized.b);
    
    // Calculate confidence based on color properties
    let confidence = 1.0;
    
    // Higher confidence for more saturated colors (easier to classify)
    confidence *= Math.min(1.0, (s + 20) / 100);
    
    // Higher confidence for colors in the middle brightness range (after normalization)
    if (v > 30 && v < 80) {
      confidence *= 1.2;
    } else if (v < 25 || v > 85) {
      confidence *= 0.7;
    }
    
    // Be more conservative with red confidence to avoid false positives
    if (color === 'red') {
      confidence *= 0.8; // Reduce red confidence
      // Require higher saturation for red
      if (s < 40) confidence *= 0.5;
    } else if (color === 'blue' || color === 'green') {
      confidence *= 1.1;
    } else if (color === 'yellow' || color === 'orange' || color === 'purple') {
      confidence *= 1.05;
    }
    
    // Penalize very low saturation colors (except for true grays/whites/blacks)
    if (s < 15 && color !== 'white' && color !== 'black' && color !== 'gray') {
      confidence *= 0.4;
    }
    
    // Initialize or update vote
    if (!colorVotes[color]) {
      colorVotes[color] = { count: 0, confidence: 0 };
    }
    
    colorVotes[color].count += 1;
    colorVotes[color].confidence += confidence;
  });

  // Find the most confident color (not just most common)
  let dominantColor = '';
  let maxScore = 0;
  
  for (const [color, vote] of Object.entries(colorVotes)) {
    // Score combines frequency and average confidence
    const avgConfidence = vote.confidence / vote.count;
    const score = vote.count * avgConfidence;
    
    if (score > maxScore) {
      maxScore = score;
      dominantColor = color;
    }
  }

  const totalPixels = rgbSamples.length;
  const winningVote = colorVotes[dominantColor];
  const confidence = totalPixels > 0 && winningVote ? 
    (winningVote.count / totalPixels) * (winningVote.confidence / winningVote.count) : 0;

  // Enhanced logging for better debugging
  console.log('Enhanced color analysis:', {
    totalSamples: totalPixels,
    dominantColor,
    confidence: Math.round(confidence * 100) + '%',
    colorBreakdown: Object.entries(colorVotes).map(([color, vote]) => ({
      color,
      count: vote.count,
      avgConfidence: Math.round((vote.confidence / vote.count) * 100) / 100,
      score: Math.round((vote.count * (vote.confidence / vote.count)) * 100) / 100,
      percentage: Math.round((vote.count / totalPixels) * 100) + '%'
    })).sort((a, b) => b.score - a.score)
  });

  return { color: dominantColor, confidence };
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
