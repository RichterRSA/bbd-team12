import QrScanner from "qr-scanner";
import { RefObject } from "react";
import Webcam from "react-webcam";

export interface QrScannerConfig {
  onScan: (result: string) => void;
  maxScansPerSecond?: number;
  highlightScanRegion?: boolean;
  highlightCodeOutline?: boolean;
}

export interface QrScannerHook {
  scanner: QrScanner | null;
  isScanning: boolean;
  lastScannedCode: string | null;
  startScanning: () => Promise<void>;
  stopScanning: () => void;
  destroyScanner: () => void;
}

/**
 * Initialize QR Scanner on a video element
 */
export const initializeQrScanner = (
  video: HTMLVideoElement,
  config: QrScannerConfig
): QrScanner => {
  const scanner = new QrScanner(video, (result) => {
    console.log("QR Code detected:", result);
    config.onScan(result.data);
  }, {
    returnDetailedScanResult: true,
    highlightScanRegion: config.highlightScanRegion ?? false,
    highlightCodeOutline: config.highlightCodeOutline ?? false,
    maxScansPerSecond: config.maxScansPerSecond ?? 5
  });

  return scanner;
};

/**
 * Setup QR Scanner with webcam ref - handles video ready state
 */
export const setupQrScannerWithWebcam = (
  webcamRef: RefObject<Webcam | null>,
  config: QrScannerConfig,
  hasCameraPermission: boolean,
  onScannerReady?: (scanner: QrScanner) => void
): (() => void) => {
  if (!webcamRef.current?.video || !hasCameraPermission) {
    return () => {}; // Return empty cleanup function
  }

  const video = webcamRef.current.video;
  let scanner: QrScanner | null = null;

  // Wait for video to be ready
  const initQrScanner = () => {
    if (video.readyState >= 2) { // HAVE_CURRENT_DATA
      scanner = initializeQrScanner(video, config);
      
      scanner.start().catch((error) => {
        console.error("Failed to start QR scanner:", error);
      });

      if (onScannerReady) {
        onScannerReady(scanner);
      }
    } else {
      video.addEventListener('loadeddata', initQrScanner, { once: true });
    }
  };

  initQrScanner();

  // Return cleanup function
  return () => {
    scanner?.stop();
    scanner?.destroy();
  };
};

/**
 * Throttled QR code handler - prevents rapid successive scans
 */
export const createThrottledQrHandler = (
  callback: (result: string) => void,
  throttleMs: number = 2000
) => {
  let lastScanTime = 0;

  return (result: string) => {
    const now = Date.now();
    if (now - lastScanTime <= throttleMs) return;
    
    lastScanTime = now;
    callback(result);
  };
};

/**
 * Game-specific QR code handlers
 */
export const createGameQrHandlers = (
  gameState: any,
  player: any,
  socketRef: any,
  setNotifications: (fn: (prev: string[]) => string[]) => void,
  triggerVibration: () => void
) => {
  const weapons = [
    { type: "Pistol", damage: 10, cost: 0 },
    { type: "Rifle", damage: 20, cost: 0 },
    { type: "Sniper", damage: 50, cost: 0 }
  ];

  const handleWeaponScan = (result: string) => {
    if (!["pistol", "rifle", "sniper"].includes(result) || player.status !== "alive") return false;

    const weapon = weapons.find((w) => w.type.toLowerCase() === result);
    if (weapon && socketRef.current) {
      socketRef.current.emit("purchaseWeapon", {
        gameId: gameState.id,
        playerId: socketRef.current.id,
        weapon
      });
      setNotifications((prev) => [...prev, `Scanned ${result} weapon`].slice(-3));
      triggerVibration();
      new Audio("/sounds/powerup.wav").play().catch((e) => console.error("Sound error:", e));
      return true;
    }
    return false;
  };

  const handleTreasureScan = (result: string) => {
    if (result !== "treasure" || player.status !== "alive") return false;

    if (socketRef.current) {
      socketRef.current.emit("collectTreasure", {
        gameId: gameState.id,
        playerId: socketRef.current.id,
        item: result
      });
      setNotifications((prev) => [...prev, `Scanned treasure`].slice(-3));
      triggerVibration();
      new Audio("/sounds/lasershot.mp3").play().catch((e) => console.error("Sound error:", e));
      return true;
    }
    return false;
  };

  const handleReviveScan = (result: string) => {
    if (result !== "revive" || player.status !== "dead") return false;

    if (socketRef.current) {
      socketRef.current.emit("revivePlayer", {
        gameId: gameState.id,
        playerId: socketRef.current.id
      });
      setNotifications((prev) => [...prev, `Scanned revive`].slice(-3));
      triggerVibration();
      new Audio("/sounds/lasershot.mp3").play().catch((e) => console.error("Sound error:", e));
      return true;
    }
    return false;
  };

  const handleGenericScan = (result: string) => {
    if (!gameState || !player || !socketRef.current) return;

    if (player.status === "dead" && result !== "revive") {
      socketRef.current.emit("notification", "Cannot scan items: You are dead");
      return;
    }

    // Try each handler in sequence
    if (handleWeaponScan(result)) return;
    if (handleTreasureScan(result)) return;
    if (handleReviveScan(result)) return;

    // If no handler processed the code, it might be an unknown code
    console.log("Unknown QR code:", result);
  };

  return {
    handleWeaponScan,
    handleTreasureScan,
    handleReviveScan,
    handleGenericScan
  };
};

/**
 * Simple QR code handler for testing/demo purposes
 */
export const createSimpleQrHandler = (
  onScan: (result: string) => void,
  triggerVibration?: () => void
) => {
  return (result: string) => {
    console.log("QR Code scanned:", result);
    onScan(result);
    if (triggerVibration) {
      triggerVibration();
    }
  };
};
