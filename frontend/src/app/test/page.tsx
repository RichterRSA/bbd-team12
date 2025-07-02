"use client";

import { ShakeEvent, useShakeDetector, ShakeDetector } from '@/utils/shakeDetector';
import React, { useState, useEffect } from 'react';

const ShakeDetectorExample: React.FC = () => {
  const [shakeCount, setShakeCount] = useState(0);
  const [lastShake, setLastShake] = useState<ShakeEvent | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Ensure we're on the client side before accessing navigator
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Enhanced vibration function that works on both Android and iOS
  const triggerVibration = () => {
    if (typeof window === 'undefined') return false;
    
    try {
      // Check multiple vibration APIs for better compatibility
      if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
        // Standard Vibration API (Android, some iOS versions)
        navigator.vibrate([300, 100, 300, 100, 300]);
        console.log('Vibration triggered via navigator.vibrate');
        return true;
      } else if ((window as any).navigator?.vibrate) {
        // Fallback check
        (window as any).navigator.vibrate([300, 100, 300, 100, 300]);
        console.log('Vibration triggered via window.navigator.vibrate');
        return true;
      } else {
        console.log('Vibration API not available on this device');
        return false;
      }
    } catch (error) {
      console.error('Error triggering vibration:', error);
      return false;
    }

  };

  // Callback function that gets called when shake is detected
  const handleShake = (event: ShakeEvent) => {
    console.log('Shake detected!', event);
    
    setShakeCount(prev => {
      const newCount = prev + 1;
      console.log(`Shake count updated: ${prev} -> ${newCount}`);
      
      // Check if this is the 5th shake
      if (newCount >= 5) {
        console.log('5 shakes reached! Triggering vibration and reset...');
        
        // Trigger vibration immediately
        const vibrationSuccess = triggerVibration();
        
        if (!vibrationSuccess) {
          // Fallback: try alternative vibration methods for iOS
          try {
            // iOS Safari sometimes requires user interaction first
            if (window.DeviceMotionEvent && typeof (window.DeviceMotionEvent as any).requestPermission === 'function') {
              console.log('iOS device detected, vibration may require user interaction');
            }
            
            // Try HTML5 audio as alternative feedback for iOS
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.1);
            
            console.log('Audio feedback played as vibration alternative');
          } catch (audioError) {
            console.log('Audio feedback also failed:', audioError);
          }
        }
        
        // Reset counter after a brief delay
        setTimeout(() => {
          setShakeCount(0);
          setLastShake(null);
          console.log('Counter reset completed');
        }, 1500);
        
        return newCount; // Return the count to show "5" briefly
      }
      
      return newCount;
    });
    
    setLastShake(event);
  };

  // Use the shake detector hook
  const {
    startListening,
    stopListening,
    isListening,
    error,
    isSupported
  } = useShakeDetector(
    handleShake,
    {
      threshold: 15,        // Acceleration threshold
      minShakes: 1,         // Detect each individual shake (we count manually)
      timeWindow: 800,      // Within 0.8 seconds for individual shake detection
      cooldownPeriod: 300,  // Short cooldown between individual shakes
      debug: true           // Enable debug logging
    },
    true // Enabled
  );

  // Request permission (especially important for iOS)
  const requestPermission = async () => {
    const granted = await ShakeDetector.requestPermission();
    setPermissionGranted(granted);
    if (granted) {
      await startListening();
    }
  };

  if (!isClient) {
    return (
      <div className="p-6 max-w-md mx-auto bg-white rounded-lg shadow-lg">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!isSupported) {
    return (
      <div className="p-4 bg-red-100 text-red-800 rounded">
        Device motion is not supported on this device/browser.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Shake Detector Demo</h2>
      
      <div className="space-y-4">
        {/* Permission status */}
        {permissionGranted === null && (
          <button
            onClick={requestPermission}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Request Motion Permission & Start
          </button>
        )}

        {permissionGranted === false && (
          <div className="p-3 bg-red-100 text-red-800 rounded">
            Motion permission denied. Please enable in browser settings.
          </div>
        )}

        {/* Control buttons */}
        {permissionGranted && (
          <div className="space-y-2">
            <div className="flex space-x-2">
              <button
                onClick={startListening}
                disabled={isListening}
                className="flex-1 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
              >
                {isListening ? 'Listening...' : 'Start Detection'}
              </button>
              
              <button
                onClick={stopListening}
                disabled={!isListening}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-400"
              >
                Stop Detection
              </button>
            </div>
            
            {/* Test vibration button */}
            <button
              onClick={() => {
                console.log('Testing vibration manually...');
                const success = triggerVibration();
                if (!success) {
                  alert('Vibration test failed - check console for details');
                }
              }}
              className="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
            >
              🔔 Test Vibration
            </button>
            
            {/* Manual reset button */}
            <button
              onClick={() => {
                setShakeCount(0);
                setLastShake(null);
                console.log('Counter manually reset');
              }}
              className="w-full px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
            >
              🔄 Reset Counter
            </button>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="p-3 bg-red-100 text-red-800 rounded">
            Error: {error}
          </div>
        )}

        {/* Status display */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Status:</span>
            <span className={isListening ? 'text-green-600' : 'text-gray-600'}>
              {isListening ? 'Listening for shakes' : 'Not listening'}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span>Shake Progress:</span>
            <span className={`font-bold ${shakeCount >= 5 ? 'text-red-600' : 'text-blue-600'}`}>
              {shakeCount}/5 {shakeCount >= 5 ? '🎉 VIBRATING!' : ''}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div 
              className={`h-3 rounded-full transition-all duration-300 ${
                shakeCount >= 5 ? 'bg-red-500' : 'bg-blue-500'
              }`}
              style={{ width: `${Math.min((shakeCount / 5) * 100, 100)}%` }}
            ></div>
          </div>

          {/* Vibration support indicator */}
          {isClient && (
            <div className="flex justify-between text-sm">
              <span>Vibration Support:</span>
              <span className={
                ('vibrate' in navigator || (window as any).navigator?.vibrate) 
                  ? 'text-green-600' 
                  : 'text-yellow-600'
              }>
                {('vibrate' in navigator || (window as any).navigator?.vibrate) 
                  ? '✓ Supported' 
                  : '⚠ Limited/Audio fallback'}
              </span>
            </div>
          )}

          {lastShake && (
            <div className="mt-4 p-3 bg-gray-100 rounded">
              <h3 className="font-semibold mb-2">Last Shake:</h3>
              <div className="text-sm space-y-1">
                <div>Shake Count in Event: {lastShake.shakeCount}</div>
                <div>Max Acceleration: {lastShake.acceleration.toFixed(2)}</div>
                <div>Time: {new Date(lastShake.timestamp).toLocaleTimeString()}</div>
              </div>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-6 p-3 bg-blue-50 rounded">
          <h3 className="font-semibold mb-2">Instructions:</h3>
          <ul className="text-sm space-y-1">
            <li>• Hold device in portrait mode</li>
            <li>• Shake phone up and down quickly</li>
            <li>• Reach 5 total shakes to trigger vibration</li>
            <li>• Counter resets automatically after vibration</li>
            <li>• Each shake is detected individually</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ShakeDetectorExample;
