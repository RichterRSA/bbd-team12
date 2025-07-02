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
  matchedPlayer?: {
    id: string;
    name: string;
    distance: number;
  };
}

export interface ColorScannerConfig {
  scanDuration: number;
  sampleInterval: number;
  playerColors?: Array<{ id: string; name: string; color: string; rgb?: { r: number; g: number; b: number } }>;
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
   * Update player colors for matching
   */
  updatePlayerColors(playerColors: Array<{ id: string; name: string; color: string; rgb?: { r: number; g: number; b: number } }>) {
    this.config.playerColors = playerColors;
    
    // Convert color names to RGB values if they don't already have RGB
    this.config.playerColors.forEach(player => {
      if (!player.rgb) {
        player.rgb = this.colorNameToRgb(player.color);
      }
    });
  }

  /**
   * Convert color name to RGB value
   */
  private colorNameToRgb(colorName: string): { r: number; g: number; b: number } {
    // Default color map for common colors
    const colorMap: Record<string, { r: number; g: number; b: number }> = {
      'red': { r: 220, g: 50, b: 50 },
      'blue': { r: 50, g: 50, b: 220 },
      'green': { r: 50, g: 180, b: 50 },
      'yellow': { r: 220, g: 220, b: 50 },
      'purple': { r: 150, g: 50, b: 200 },
      'orange': { r: 255, g: 165, b: 0 },
      'pink': { r: 255, g: 105, b: 180 },
      'white': { r: 240, g: 240, b: 240 },
      'black': { r: 20, g: 20, b: 20 },
      'gray': { r: 128, g: 128, b: 128 }
    };

    return colorMap[colorName.toLowerCase()] || { r: 128, g: 128, b: 128 };
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

      // Extract raw RGB values from the torso area
      const rgbResult = await this.getRawTorsoRGB(poses[0], this.videoElement);
      if (!rgbResult) return null;
      
      // Match against player colors if available, otherwise use standard categorization
      let colorName: string | null = null;
      let confidence = 0.8; // Default confidence
      
      if (this.config.playerColors && this.config.playerColors.length > 0) {
        const match = this.findClosestPlayerColor(rgbResult);
        if (match) {
          colorName = match.color;
          // Adjust confidence based on match distance
          // Lower distance = higher confidence
          confidence = Math.max(0.3, 1.0 - (match.distance / 100));
        } else {
          // No good match found, return null
          return null;
        }
      } else {
        // Use standard categorization if no player colors are available
        const colorResult = extractTorsoColor(poses[0], this.videoElement, 0.3);
        if (!colorResult) return null;
        
        colorName = colorResult.color;
        confidence = colorResult.confidence;
      }
      
      // If no color name could be determined, return null
      if (!colorName) return null;
      
      return {
        color: colorName,
        confidence: confidence,
        timestamp: Date.now(),
        rgb: rgbResult
      };
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

    // Sample entire torso area
    const width = maxX - minX;
    const height = maxY - minY;
    const x = Math.max(0, Math.min(minX, video.videoWidth - width));
    const y = Math.max(0, Math.min(minY, video.videoHeight - height));
    
    // Get color data from the entire torso region
    const imageData = tempCtx.getImageData(x, y, width, height);
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
   * Calculate Euclidean distance between two RGB colors
   * Lower values mean colors are more similar
   */
  private colorDistance(color1: { r: number; g: number; b: number }, color2: { r: number; g: number; b: number }): number {
    // Convert to Lab color space for more perceptually accurate color comparison
    const lab1 = this.rgbToLab(color1.r, color1.g, color1.b);
    const lab2 = this.rgbToLab(color2.r, color2.g, color2.b);
    
    // Calculate Euclidean distance in Lab color space
    const deltaL = lab1.l - lab2.l;
    const deltaA = lab1.a - lab2.a;
    const deltaB = lab1.b - lab2.b;
    
    return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
  }
  
  /**
   * Convert RGB to Lab color space for better perceptual color matching
   */
  private rgbToLab(r: number, g: number, b: number): { l: number; a: number; b: number } {
    // First convert RGB to XYZ
    r /= 255;
    g /= 255;
    b /= 255;
    
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    
    r *= 100;
    g *= 100;
    b *= 100;
    
    const x = r * 0.4124 + g * 0.3576 + b * 0.1805;
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const z = r * 0.0193 + g * 0.1192 + b * 0.9505;
    
    // Then convert XYZ to Lab
    const xRef = 95.047;
    const yRef = 100.0;
    const zRef = 108.883;
    
    let xNorm = x / xRef;
    let yNorm = y / yRef;
    let zNorm = z / zRef;
    
    xNorm = xNorm > 0.008856 ? Math.pow(xNorm, 1/3) : (7.787 * xNorm) + (16 / 116);
    yNorm = yNorm > 0.008856 ? Math.pow(yNorm, 1/3) : (7.787 * yNorm) + (16 / 116);
    zNorm = zNorm > 0.008856 ? Math.pow(zNorm, 1/3) : (7.787 * zNorm) + (16 / 116);
    
    return {
      l: (116 * yNorm) - 16,
      a: 500 * (xNorm - yNorm),
      b: 200 * (yNorm - zNorm)
    };
  }
  
  /**
   * Find the closest matching player color
   */
  private findClosestPlayerColor(
    rgb: { r: number; g: number; b: number }
  ): { playerId: string; playerName: string; color: string; distance: number } | null {
    if (!this.config.playerColors || this.config.playerColors.length === 0) {
      // Fallback to standard categorization if no player colors available
      const colorName = categorizeColor(rgb.r, rgb.g, rgb.b);
      return { playerId: '', playerName: '', color: colorName, distance: 0 };
    }
    
    let closestPlayer: { playerId: string; playerName: string; color: string; distance: number } | null = null;
    let minDistance = Infinity;
    
    for (const player of this.config.playerColors) {
      if (!player.rgb) continue;
      
      const distance = this.colorDistance(rgb, player.rgb);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestPlayer = {
          playerId: player.id,
          playerName: player.name,
          color: player.color,
          distance
        };
      }
    }
    
    // Only return a match if the distance is below a certain threshold
    // Lab color space distances: ~2.3 is just noticeable, ~5 is clearly different, >10 is significantly different
    // Using a more lenient threshold to accommodate muted colors
    const MATCH_THRESHOLD = 50; // Increased threshold for muted colors
    
    if (closestPlayer) {
      return closestPlayer; // Return the closest match regardless of distance
    } else {
      return null;
    }
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

    // Instead of just counting color names, match each sample to a player color
    const playerColorMatches: { [key: string]: { count: number; distance: number } } = {};
    
    // Process each sample individually to match against player colors
    let validMatches = 0; // Count how many samples had valid matches
    
    this.colorSamples.forEach(sample => {
      const match = this.findClosestPlayerColor(sample.rgb);
      if (match) {
        validMatches++;
        if (!playerColorMatches[match.color]) {
          playerColorMatches[match.color] = { count: 0, distance: 0 };
        }
        playerColorMatches[match.color].count++;
        playerColorMatches[match.color].distance += match.distance;
      }
    });
    
    // If we have too few valid matches, consider it a failure
    const MIN_VALID_MATCH_RATIO = 0.3; // At least 30% of samples must match
    if (validMatches < this.colorSamples.length * MIN_VALID_MATCH_RATIO) {
      if (this.onError) {
        this.onError("No consistent color match found. The person may not be wearing a color that matches any player.");
      }
      // Return with some minimal information - the caller will handle this
      return {
        dominantColor: '',
        averageRgb: { r: avgR, g: avgG, b: avgB },
        confidence: 0,
        sampleCount: this.colorSamples.length,
        detectionDuration: this.scanStartTime ? Date.now() - this.scanStartTime : this.config.scanDuration,
        matchedPlayer: undefined
      };
    }

    // Find dominant color based on frequency and average distance
    let dominantColor = '';
    let maxScore = -Infinity;
    
    for (const [color, data] of Object.entries(playerColorMatches)) {
      // Calculate average distance for this color match
      const avgDistance = data.distance / data.count;
      
      // Score = frequency - distance penalty (higher is better)
      // This prioritizes colors that appear often and have low distance
      const score = data.count - (avgDistance / 10); 
      
      if (score > maxScore) {
        maxScore = score;
        dominantColor = color;
      }
    }
    
    // If no dominant color was found despite having matches, something is wrong
    if (!dominantColor && Object.keys(playerColorMatches).length > 0) {
      console.error("Logical error: Had player color matches but no dominant color was selected");
    }

    // Calculate average confidence
    const avgConfidence = this.colorSamples.reduce((sum, sample) => sum + sample.confidence, 0) / this.colorSamples.length;
    
    // Calculate detection duration
    const detectionDuration = this.scanStartTime ? Date.now() - this.scanStartTime : this.config.scanDuration;

    // Log the color matching details for debugging
    console.log('Player color matching:', {
      averageRgb: { r: avgR, g: avgG, b: avgB },
      playerColorMatches,
      dominantColor,
      playerColors: this.config.playerColors
    });

    // Find the player that matches the dominant color
    let matchedPlayer = undefined;
    if (this.config.playerColors && dominantColor) {
      const playerMatch = this.config.playerColors.find(p => p.color === dominantColor);
      if (playerMatch && playerColorMatches[dominantColor]) {
        matchedPlayer = {
          id: playerMatch.id,
          name: playerMatch.name,
          distance: playerColorMatches[dominantColor].distance / playerColorMatches[dominantColor].count
        };
      }
    }

    return {
      dominantColor,
      averageRgb: { r: avgR, g: avgG, b: avgB },
      confidence: avgConfidence,
      sampleCount: this.colorSamples.length,
      detectionDuration,
      matchedPlayer
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
  
  // Preserve the original value more for mid-range colors
  if (v < 20) {
    // Only boost very dark colors
    normalizedV = Math.min(v * 1.2, 35);
  }
  else if (v > 95) {
    // Only reduce very bright colors
    normalizedV = Math.max(v * 0.97, 90);
  }
  else {
    // Leave mid-range values almost completely alone
    normalizedV = v;
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

  // Simple sampling of all pixels
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    
    // Only skip fully transparent pixels
    if (a === 0) continue;
    
    rgbSamples.push({ r, g, b });
  }

  // Simply calculate the average RGB values
  let totalR = 0, totalG = 0, totalB = 0;
  let count = rgbSamples.length;

  rgbSamples.forEach(sample => {
    totalR += sample.r;
    totalG += sample.g;
    totalB += sample.b;
  });

  if (count === 0) return null;

  const avgR = Math.round(totalR / count);
  const avgG = Math.round(totalG / count);
  const avgB = Math.round(totalB / count);

  // Use the raw average color
  const color = `rgb(${avgR},${avgG},${avgB})`;
  const confidence = 1.0; // Always return full confidence since we're using raw values

  // Log the raw color values
  console.log('Raw color analysis:', {
    averageColor: `rgb(${avgR},${avgG},${avgB})`,
    sampleCount: count
  });

  return { color: `rgb(${avgR},${avgG},${avgB})`, confidence: 1.0 };
};
