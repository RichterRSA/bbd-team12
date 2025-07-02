import * as poseDetection from '@tensorflow-models/pose-detection';
import { extractTorsoColor } from './poseDetection';

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
