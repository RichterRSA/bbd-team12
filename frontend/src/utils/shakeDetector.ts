/**
 * Shake Detection Utility for React Applications
 * Detects vertical phone shakes using device accelerometer data
 */

export interface ShakeDetectorOptions {
  /** Minimum acceleration threshold to register as a shake (default: 15) */
  threshold?: number;
  /** Minimum number of shakes required to trigger callback (default: 3) */
  minShakes?: number;
  /** Time window in milliseconds to detect shakes (default: 1000ms) */
  timeWindow?: number;
  /** Cooldown period in milliseconds between detections (default: 2000ms) */
  cooldownPeriod?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

export interface ShakeEvent {
  shakeCount: number;
  acceleration: number;
  timestamp: number;
}

export class ShakeDetector {
  private options: Required<ShakeDetectorOptions>;
  private callback: (event: ShakeEvent) => void;
  private isListening: boolean = false;
  private shakeEvents: Array<{ timestamp: number; acceleration: number }> = [];
  private lastShakeTime: number = 0;
  private deviceMotionHandler: ((event: DeviceMotionEvent) => void) | null = null;

  constructor(callback: (event: ShakeEvent) => void, options: ShakeDetectorOptions = {}) {
    this.callback = callback;
    this.options = {
      threshold: options.threshold ?? 15,
      minShakes: options.minShakes ?? 3,
      timeWindow: options.timeWindow ?? 1000,
      cooldownPeriod: options.cooldownPeriod ?? 2000,
      debug: options.debug ?? false
    };

    this.deviceMotionHandler = this.handleDeviceMotion.bind(this);
  }

  /**
   * Start listening for shake events
   * Requests permission for device motion on iOS 13+
   */
  public async start(): Promise<void> {
    if (this.isListening) {
      if (this.options.debug) console.log('ShakeDetector: Already listening');
      return;
    }

    try {
      // Check if DeviceMotionEvent is supported
      if (typeof DeviceMotionEvent === 'undefined') {
        throw new Error('DeviceMotionEvent is not supported on this device');
      }

      // Request permission for iOS 13+ devices
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        const permission = await (DeviceMotionEvent as any).requestPermission();
        if (permission !== 'granted') {
          throw new Error('Permission denied for device motion');
        }
      }

      // Add event listener
      if (this.deviceMotionHandler) {
        window.addEventListener('devicemotion', this.deviceMotionHandler);
        this.isListening = true;
        if (this.options.debug) console.log('ShakeDetector: Started listening for shakes');
      }
    } catch (error) {
      console.error('ShakeDetector: Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop listening for shake events
   */
  public stop(): void {
    if (!this.isListening) {
      if (this.options.debug) console.log('ShakeDetector: Not currently listening');
      return;
    }

    if (this.deviceMotionHandler) {
      window.removeEventListener('devicemotion', this.deviceMotionHandler);
      this.isListening = false;
      this.shakeEvents = [];
      if (this.options.debug) console.log('ShakeDetector: Stopped listening for shakes');
    }
  }

  /**
   * Check if currently listening for shake events
   */
  public get listening(): boolean {
    return this.isListening;
  }

  /**
   * Update detection options
   */
  public updateOptions(newOptions: Partial<ShakeDetectorOptions>): void {
    this.options = {
      ...this.options,
      ...newOptions
    };
    if (this.options.debug) console.log('ShakeDetector: Options updated', this.options);
  }

  /**
   * Handle device motion events
   */
  private handleDeviceMotion(event: DeviceMotionEvent): void {
    const acceleration = event.accelerationIncludingGravity;
    
    if (!acceleration || acceleration.y === null) {
      return;
    }

    // Calculate vertical acceleration magnitude (Y-axis for vertical shakes)
    const verticalAcceleration = Math.abs(acceleration.y);
    const currentTime = Date.now();

    // Check if acceleration exceeds threshold
    if (verticalAcceleration > this.options.threshold) {
      // Check cooldown period
      if (currentTime - this.lastShakeTime < this.options.cooldownPeriod) {
        return;
      }

      // Add shake event
      this.shakeEvents.push({
        timestamp: currentTime,
        acceleration: verticalAcceleration
      });

      if (this.options.debug) {
        console.log(`ShakeDetector: Shake detected - Acceleration: ${verticalAcceleration.toFixed(2)}`);
      }

      // Clean up old events outside time window
      this.cleanupOldEvents(currentTime);

      // Check if we have enough shakes in the time window
      if (this.shakeEvents.length >= this.options.minShakes) {
        const maxAcceleration = Math.max(...this.shakeEvents.map(e => e.acceleration));
        
        const shakeEvent: ShakeEvent = {
          shakeCount: this.shakeEvents.length,
          acceleration: maxAcceleration,
          timestamp: currentTime
        };

        if (this.options.debug) {
          console.log(`ShakeDetector: Shake pattern detected! Count: ${shakeEvent.shakeCount}, Max acceleration: ${maxAcceleration.toFixed(2)}`);
        }

        // Trigger callback
        this.callback(shakeEvent);

        // Update last shake time and reset events
        this.lastShakeTime = currentTime;
        this.shakeEvents = [];
      }
    }
  }

  /**
   * Remove shake events outside the time window
   */
  private cleanupOldEvents(currentTime: number): void {
    const cutoffTime = currentTime - this.options.timeWindow;
    this.shakeEvents = this.shakeEvents.filter(event => event.timestamp > cutoffTime);
  }

  /**
   * Check if device motion is supported
   */
  public static isSupported(): boolean {
    return typeof DeviceMotionEvent !== 'undefined' && 
           typeof window !== 'undefined' && 
           'addEventListener' in window;
  }

  /**
   * Request permission for device motion (iOS 13+)
   */
  public static async requestPermission(): Promise<boolean> {
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        const permission = await (DeviceMotionEvent as any).requestPermission();
        return permission === 'granted';
      } catch (error) {
        console.error('Failed to request device motion permission:', error);
        return false;
      }
    }
    return true; // Permission not required on other platforms
  }
}

/**
 * React Hook for shake detection
 */
export const useShakeDetector = (
  callback: (event: ShakeEvent) => void,
  options: ShakeDetectorOptions = {},
  enabled: boolean = true
) => {
  const [detector, setDetector] = React.useState<ShakeDetector | null>(null);
  const [isListening, setIsListening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;

    const shakeDetector = new ShakeDetector(callback, options);
    setDetector(shakeDetector);

    return () => {
      shakeDetector.stop();
    };
  }, [enabled, options.threshold, options.minShakes, options.timeWindow, options.cooldownPeriod]);

  const startListening = React.useCallback(async () => {
    if (!detector) return;

    try {
      await detector.start();
      setIsListening(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start shake detection');
      setIsListening(false);
    }
  }, [detector]);

  const stopListening = React.useCallback(() => {
    if (!detector) return;

    detector.stop();
    setIsListening(false);
  }, [detector]);

  return {
    startListening,
    stopListening,
    isListening,
    error,
    isSupported: ShakeDetector.isSupported()
  };
};

// Import React for the hook
import React from 'react';
