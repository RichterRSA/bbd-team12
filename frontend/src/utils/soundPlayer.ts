/**
 * Sound Player Utility for Managing Audio Events
 * Handles playback of audio files for game events like shooting, reloading, etc.
 */
export interface SoundPlayerOptions {
  /** Base URL or path for sound files (default: "/sounds/") */
  basePath?: string;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Maximum number of simultaneous audio instances (default: 3) */
  maxInstances?: number;
}

export interface SoundEvent {
  type: string; // e.g., "shoot", "reload", "hit"
  loop?: boolean; // Whether to loop the sound (default: false)
  timestamp: number; // When the event occurred
  customFile?: string; // Optional custom filename for the sound
}

export class SoundPlayer {
  private options: Required<SoundPlayerOptions>;
  private activeSounds: HTMLAudioElement[] = [];
  private isPlaying: boolean = false;
  private eventQueue: SoundEvent[] = [];

  constructor(options: SoundPlayerOptions = {}) {
    this.options = {
      basePath: options.basePath ?? "/sounds/",
      debug: options.debug ?? false,
      maxInstances: options.maxInstances ?? 3
    };
  }

  /**
   * Play a sound for a specific game event
   * @param eventType - Type of event (e.g., "shoot", "reload", "hit")
   * @param customFile - Optional custom filename (overrides default mapping)
   * @param loop - Whether to loop the sound (default: false)
   */
  public playSound(eventType: string, customFile?: string, loop: boolean = false): void {
    const now = Date.now();
    const soundEvent: SoundEvent = { type: eventType, loop, timestamp: now };
    this.eventQueue.push(soundEvent);

    if (!this.isPlaying) {
      this.processQueue();
    }

    if (this.options.debug) {
      console.log(`SoundPlayer: Queued ${eventType} sound - Loop: ${loop}`);
    }
  }

  /**
   * Process the sound event queue
   * Manages concurrent audio instances and triggers playback
   */
  private processQueue(): void {
    this.isPlaying = true;

    while (this.eventQueue.length > 0 && this.activeSounds.length < this.options.maxInstances) {
      const event = this.eventQueue.shift();
      if (!event) continue;

      const fileName = this.getSoundFileName(event.type, event);
      const audio = new Audio(`${this.options.basePath}${fileName}`);

      audio.volume = 1.0; // Maximum volume for all events
      audio.loop = event.loop ?? false;

      audio.onplay = () => {
        if (this.options.debug) {
          console.log(`SoundPlayer: Playing ${event.type} - File: ${fileName}`);
        }
      };

      audio.onended = () => {
        this.cleanupSound(audio);
        this.processQueue();
      };

      audio.onerror = (error) => {
        console.error(`SoundPlayer: Failed to play ${event.type}:`, error);
        this.cleanupSound(audio);
        this.processQueue();
      };

      this.activeSounds.push(audio);
      audio.play().catch((error) => {
        console.error(`SoundPlayer: Playback error for ${event.type}:`, error);
        this.cleanupSound(audio);
      });
    }

    if (this.eventQueue.length === 0 && this.activeSounds.length === 0) {
      this.isPlaying = false;
    }
  }

  /**
   * Determine the appropriate sound file based on event type
   * @param eventType - Type of event to map to a sound file
   * @param event - Full event object for custom overrides
   */
  private getSoundFileName(eventType: string, event: SoundEvent): string {
    const soundMap: { [key: string]: string } = {
      shoot: "singleshot.mp3",
      reload: "reload.mp3",
      hit: "laser.mp3",
      powerup: "powerup.wav",
      eliminated: "eliminated.mp3"
    };

    return event.customFile ?? soundMap[eventType.toLowerCase()] ?? "default.mp3";
  }

  /**
   * Clean up completed or errored audio instances
   */
  private cleanupSound(audio: HTMLAudioElement): void {
    const index = this.activeSounds.indexOf(audio);
    if (index !== -1) {
      this.activeSounds.splice(index, 1);
    }
    audio.pause();
    audio.currentTime = 0;
  }

  /**
   * Stop all currently playing sounds
   */
  public stopAll(): void {
    this.activeSounds.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    this.activeSounds = [];
    this.eventQueue = [];
    this.isPlaying = false;
    if (this.options.debug) {
      console.log("SoundPlayer: Stopped all sounds");
    }
  }

  /**
   * Check if sound playback is currently active
   */
  public get playing(): boolean {
    return this.isPlaying;
  }

  /**
   * Update player options dynamically
   */
  public updateOptions(newOptions: Partial<SoundPlayerOptions>): void {
    this.options = {
      ...this.options,
      ...newOptions
    };
    if (this.options.debug) {
      console.log("SoundPlayer: Options updated", this.options);
    }
  }

  /**
   * Check if audio is supported by the browser
   */
  public static isSupported(): boolean {
    return typeof Audio !== "undefined" && typeof window !== "undefined" && "play" in new Audio();
  }
}

/**
 * React Hook for sound player integration
 */
export const useSoundPlayer = (
  options: SoundPlayerOptions = {},
  enabled: boolean = true
) => {
  const [player, setPlayer] = React.useState<SoundPlayer | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;

    const soundPlayer = new SoundPlayer(options);
    setPlayer(soundPlayer);

    return () => {
      soundPlayer.stopAll();
    };
  }, [enabled, options.basePath, options.maxInstances, options.debug]);

  const playSound = React.useCallback((eventType: string, customFile?: string, loop?: boolean) => {
    if (player) {
      player.playSound(eventType, customFile, loop);
    }
  }, [player]);

  const stopAll = React.useCallback(() => {
    if (player) {
      player.stopAll();
    }
  }, [player]);

  return {
    playSound,
    stopAll,
    isPlaying: player?.playing ?? false,
    isSupported: SoundPlayer.isSupported(),
    error
  };
};

// Import React for the hook
import React from "react";