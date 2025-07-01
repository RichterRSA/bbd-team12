import * as poseDetection from "@tensorflow-models/pose-detection";
import Webcam from "react-webcam";

export interface Coordinate {
  x: number;
  y: number;
}

export const isMobileDevice = () => {
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
  const ctx = canvasRef.current?.getContext("2d");
  const video = webcamRef.current?.video;

  if (!ctx || !video) {
    console.error("Canvas or video not ready for bounding box");
    return null;
  }

  const canvas = canvasRef.current;
  if (!canvas) return null;

  // Get scaling factors
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const displayWidth = video.clientWidth;
  const displayHeight = video.clientHeight;
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

  boundingBox?.forEach(point => {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  });

  if (minX === Infinity || minY === Infinity || 
      maxX === -Infinity || maxY === -Infinity) {
    return null;
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

export const categorizeColor = (r: number, g: number, b: number): string => {
  // Convert to HSV for better color classification
  const { h, s, v } = rgbToHsv(r, g, b);
  
  // Handle grayscale colors (low saturation)
  if (s < 15) {
    if (v < 25) return 'black';
    if (v > 80) return 'white';
    return 'gray';
  }
  
  // Handle very dark colors
  if (v < 25) return 'black';
  
  // Handle very light colors with some saturation
  if (v > 85 && s < 30) return 'white';
  
  // Classify based on hue ranges that better match real clothing colors
  // Adjusted ranges to be more forgiving for real-world colors
  if (h >= 0 && h <= 15) return 'red';        // Red (0-15°)
  if (h >= 16 && h <= 35) return 'orange';     // Orange (16-35°)
  if (h >= 36 && h <= 70) return 'yellow';     // Yellow (36-70°)
  if (h >= 71 && h <= 150) return 'green';     // Green (71-150°)
  if (h >= 151 && h <= 210) return 'blue';     // Blue (151-210°)
  if (h >= 211 && h <= 270) return 'purple';   // Purple (211-270°)
  if (h >= 271 && h <= 330) return 'pink';     // Pink/Magenta (271-330°)
  if (h >= 331 && h <= 359) return 'red';      // Red (331-359°)
  
  // Default fallback
  return 'gray';
};

export function drawDetections(
  detections: poseDetection.Pose[], 
  canvasRef: React.RefObject<HTMLCanvasElement | null>, 
  webcamRef: React.RefObject<Webcam | null>,
  highFpsMode: boolean = true
) {
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
  
  // Draw all detected poses
  detections.forEach(pose => {
    if (!pose.keypoints || pose.keypoints.length === 0) return;
    
    const keypoints: poseDetection.Keypoint[] = pose.keypoints;
    
    // Draw connections (skeleton) - optimized for high framerates
    ctx.strokeStyle = "rgba(0, 128, 255, 0.9)"; // Semi-transparent blue
    ctx.lineWidth = 3;     

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

    // Draw the torso box
    drawTorsoBox(pose, canvasRef, webcamRef, confidenceThreshold);
  }); 
}

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
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');

  if (!tempCtx) {
    console.error("Could not create temporary canvas for color extraction.");
    return null;
  }

  // Set temp canvas to video dimensions
  tempCanvas.width = Math.round(video.videoWidth);
  tempCanvas.height = Math.round(video.videoHeight);

  // Draw the current video frame to temp canvas
  tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

  // Find torso bounding box
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  validBodyKeypoints.forEach(keypoint => {
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

  // Add some padding and ensure valid bounds
  const padding = 10;
  const x = Math.max(0, Math.round(minX - padding));
  const y = Math.max(0, Math.round(minY - padding));
  const width = Math.max(1, Math.min(Math.round(maxX - minX + 2 * padding), video.videoWidth - x));
  const height = Math.max(1, Math.min(Math.round(maxY - minY + 2 * padding), video.videoHeight - y));

  // Validate all coordinates and dimensions are finite and valid
  if (!isFinite(x) || !isFinite(y) || !isFinite(width) || !isFinite(height)) {
    console.error("Invalid torso extraction coordinates:", { x, y, width, height, minX, maxX, minY, maxY });
    return null;
  }

  if (width <= 0 || height <= 0) {
    console.error("Invalid torso extraction dimensions:", { width, height });
    return null;
  }

  // Get image data from the torso region
  const data: ImageData = tempCtx.getImageData(x, y, width, height);

  // Improved color analysis with better filtering
  const colorCounts: { [key: string]: number } = {};
  const rgbSamples: { r: number; g: number; b: number }[] = [];
  const pixels = data.data;

  // First pass: collect valid color samples
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3]; // Alpha channel
    
    // Skip transparent or very transparent pixels
    if (a < 200) continue;
    
    // Calculate brightness and saturation for better filtering
    const brightness = (r + g + b) / 3;
    const maxRgb = Math.max(r, g, b);
    const minRgb = Math.min(r, g, b);
    const saturation = maxRgb === 0 ? 0 : (maxRgb - minRgb) / maxRgb;
    
    // More sophisticated filtering:
    // - Skip very dark pixels (shadows) and very bright pixels (highlights)
    // - But be less aggressive to capture more clothing colors
    if (brightness < 30 || brightness > 220) continue;
    
    // Skip pixels that are too desaturated (likely background or lighting artifacts)
    // Unless they're clearly white/gray/black clothing
    if (saturation < 0.1 && brightness > 40 && brightness < 200) {
      // Potential gray/white clothing - be more lenient
      if (brightness < 80 || brightness > 180) continue;
    }
    
    rgbSamples.push({ r, g, b });
  }

  // If we don't have enough samples, try with more lenient filtering
  if (rgbSamples.length < 10) {
    rgbSamples.length = 0; // Clear array
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      
      if (a < 150) continue;
      const brightness = (r + g + b) / 3;
      if (brightness < 20 || brightness > 235) continue;
      
      rgbSamples.push({ r, g, b });
    }
  }

  // Categorize each sample
  rgbSamples.forEach(sample => {
    const color = categorizeColor(sample.r, sample.g, sample.b);
    colorCounts[color] = (colorCounts[color] || 0) + 1;
  });

  // Find the most common color
  let dominantColor = '';
  let maxCount = 0;
  for (const [color, count] of Object.entries(colorCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantColor = color;
    }
  }

  const totalPixels = rgbSamples.length;
  const confidence = totalPixels > 0 ? maxCount / totalPixels : 0;

  // Log some debug info to help with troubleshooting
  console.log('Color analysis:', {
    totalSamples: totalPixels,
    dominantColor,
    confidence: Math.round(confidence * 100) + '%',
    colorBreakdown: Object.entries(colorCounts).map(([color, count]) => ({
      color,
      count,
      percentage: Math.round((count / totalPixels) * 100) + '%'
    }))
  });

  return { color: dominantColor, confidence };
};
