import * as poseDetection from '@tensorflow-models/pose-detection';
import { Coordinate } from './types';
import { extractTorsoColor } from './torsoDetection';

export interface ColorSample {
  color: string;
  confidence: number;
  timestamp: number;
  rgb: { r: number; g: number; b: number };
}

export interface AveragedColorResult {
  dominantColor: string;
  averageRgb: { r: number; g: number; b: number };
  confidence: number;
  sampleCount: number;
  detectionDuration: number;
}

export interface ColorScannerConfig {
  scanDuration: number;
  sampleInterval: number;
}

export class ColorScanner {
  private poseModel: poseDetection.PoseDetector | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private config: ColorScannerConfig;
  private isScanning = false;
  private scanStartTime: number | null = null;
  private colorSamples: ColorSample[] = [];
  private scanIntervalRef: NodeJS.Timeout | null = null;
  private progressIntervalRef: NodeJS.Timeout | null = null;
  private onProgress?: (progress: number, samples: ColorSample[]) => void;
  private onComplete?: (result: AveragedColorResult) => void;
  private onError?: (error: string) => void;

  constructor(config: ColorScannerConfig = { scanDuration: 1000, sampleInterval: 50 }) {
    this.config = config;
  }

  /**
   * Initialize the color scanner with pose model and video element
   */
  initialize(poseModel: poseDetection.PoseDetector, videoElement: HTMLVideoElement) {
    this.poseModel = poseModel;
    this.videoElement = videoElement;
  }

  /**
   * Set event callbacks
   */
  setCallbacks(callbacks: {
    onProgress?: (progress: number, samples: ColorSample[]) => void;
    onComplete?: (result: AveragedColorResult) => void;
    onError?: (error: string) => void;
  }) {
    this.onProgress = callbacks.onProgress;
    this.onComplete = callbacks.onComplete;
    this.onError = callbacks.onError;
  }

  /**
   * Sample color from the current video frame
   */
  private async sampleColor(): Promise<ColorSample | null> {
    if (!this.poseModel || !this.videoElement) return null;

    if (this.videoElement.readyState !== 4) return null;

    try {
      // Get current pose
      const poses = await this.poseModel.estimatePoses(this.videoElement, {
        flipHorizontal: false,
        maxPoses: 1
      });

      if (poses.length === 0) {
        return null;
      }

      // Extract color from torso region
      const colorResult = extractTorsoColor(poses[0], this.videoElement, 0.3);
      if (colorResult) {
        // Get raw RGB values from the torso area for averaging
        const rgbResult = await this.getRawTorsoRGB(poses[0], this.videoElement);
        
        return {
          color: colorResult.color,
          confidence: colorResult.confidence,
          timestamp: Date.now(),
          rgb: rgbResult || { r: 128, g: 128, b: 128 } // fallback
        };
      }
    } catch (error) {
      console.error("Error sampling color:", error);
    }

    return null;
  }

  /**
   * Helper function to get raw RGB values from torso
   */
  private async getRawTorsoRGB(pose: poseDetection.Pose, video: HTMLVideoElement): Promise<{ r: number; g: number; b: number } | null> {
    const coreBodyKeypointNames = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'];
    
    const validBodyKeypoints = pose.keypoints.filter(keypoint => 
      keypoint.name && 
      coreBodyKeypointNames.includes(keypoint.name) &&
      keypoint.score && 
      keypoint.score > 0.3
    );

    if (validBodyKeypoints.length < 3) return null;

    // Create temporary canvas to sample video
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    tempCtx.drawImage(video, 0, 0);

    // Calculate torso bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    validBodyKeypoints.forEach(keypoint => {
      minX = Math.min(minX, keypoint.x);
      maxX = Math.max(maxX, keypoint.x);
      minY = Math.min(minY, keypoint.y);
      maxY = Math.max(maxY, keypoint.y);
    });

    // Sample center area of torso
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const sampleSize = 20; // 20x20 pixel sample area
    
    const x = Math.max(0, Math.min(centerX - sampleSize/2, video.videoWidth - sampleSize));
    const y = Math.max(0, Math.min(centerY - sampleSize/2, video.videoHeight - sampleSize));
    
    const imageData = tempCtx.getImageData(x, y, sampleSize, sampleSize);
    const data = imageData.data;
    
    // Calculate average RGB
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    
    if (count === 0) return null;
    
    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count)
    };
  }

  /**
   * Start color scanning
   */
  async startScan(): Promise<void> {
    if (this.isScanning) return;
    
    this.isScanning = true;
    this.colorSamples = [];
    this.scanStartTime = Date.now();
    
    // Start sampling interval
    this.scanIntervalRef = setInterval(async () => {
      const sample = await this.sampleColor();
      if (sample) {
        this.colorSamples.push(sample);
        if (this.onProgress) {
          const elapsed = Date.now() - (this.scanStartTime || Date.now());
          const progress = Math.min((elapsed / this.config.scanDuration) * 100, 100);
          this.onProgress(progress, [...this.colorSamples]);
        }
      }
    }, this.config.sampleInterval);

    // Start progress update interval
    this.progressIntervalRef = setInterval(() => {
      const elapsed = Date.now() - (this.scanStartTime || Date.now());
      const progress = Math.min((elapsed / this.config.scanDuration) * 100, 100);
      
      if (this.onProgress) {
        this.onProgress(progress, [...this.colorSamples]);
      }
      
      if (progress >= 100) {
        this.stopScan();
      }
    }, 10);

    // Auto-stop after scan duration
    setTimeout(() => {
      this.stopScan();
    }, this.config.scanDuration);
  }

  /**
   * Stop color scanning and calculate results
   */
  stopScan(): void {
    if (!this.isScanning) return;
    
    this.isScanning = false;
    
    // Clear intervals
    if (this.scanIntervalRef) {
      clearInterval(this.scanIntervalRef);
      this.scanIntervalRef = null;
    }
    if (this.progressIntervalRef) {
      clearInterval(this.progressIntervalRef);  
      this.progressIntervalRef = null;
    }

    // Process collected samples
    if (this.colorSamples.length === 0) {
      if (this.onError) {
        this.onError("No color samples collected. Please ensure a person is visible in the frame.");
      }
      return;
    }

    const result = this.calculateResults();
    if (this.onComplete) {
      this.onComplete(result);
    }
  }

  /**
   * Calculate final results from collected samples
   */
  private calculateResults(): AveragedColorResult {
    // Calculate average RGB
    const totalR = this.colorSamples.reduce((sum, sample) => sum + sample.rgb.r, 0);
    const totalG = this.colorSamples.reduce((sum, sample) => sum + sample.rgb.g, 0);
    const totalB = this.colorSamples.reduce((sum, sample) => sum + sample.rgb.b, 0);
    
    const avgR = Math.round(totalR / this.colorSamples.length);
    const avgG = Math.round(totalG / this.colorSamples.length);
    const avgB = Math.round(totalB / this.colorSamples.length);

    // Count color occurrences for dominant color
    const colorCounts: { [key: string]: number } = {};
    this.colorSamples.forEach(sample => {
      colorCounts[sample.color] = (colorCounts[sample.color] || 0) + 1;
    });

    // Find dominant color
    let dominantColor = '';
    let maxCount = 0;
    for (const [color, count] of Object.entries(colorCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantColor = color;
      }
    }

    // Calculate average confidence
    const avgConfidence = this.colorSamples.reduce((sum, sample) => sum + sample.confidence, 0) / this.colorSamples.length;
    
    // Calculate detection duration
    const detectionDuration = this.scanStartTime ? Date.now() - this.scanStartTime : this.config.scanDuration;

    return {
      dominantColor,
      averageRgb: { r: avgR, g: avgG, b: avgB },
      confidence: avgConfidence,
      sampleCount: this.colorSamples.length,
      detectionDuration
    };
  }

  /**
   * Get current scanning status
   */
  getStatus() {
    return {
      isScanning: this.isScanning,
      sampleCount: this.colorSamples.length,
      progress: this.scanStartTime ? 
        Math.min(((Date.now() - this.scanStartTime) / this.config.scanDuration) * 100, 100) : 0
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopScan();
    this.poseModel = null;
    this.videoElement = null;
  }
}

/**
 * Utility function to get color display style
 */
export const getColorStyle = (rgb: { r: number; g: number; b: number }) => ({
  backgroundColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
  color: (rgb.r + rgb.g + rgb.b) > 384 ? '#000000' : '#FFFFFF'
});

// Helper function to convert RGB to HSV for better color analysis
export const rgbToHsv = (r: number, g: number, b: number): { h: number; s: number; v: number } => {
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
export const normalizeLighting = (r: number, g: number, b: number): { r: number; g: number; b: number } => {
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

// Helper function to analyze image data for color detection
export const analyzeImageData = (data: ImageData): {color: string, confidence: number} | null => {
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
