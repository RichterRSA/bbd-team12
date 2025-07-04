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

// Function to trigger phone vibration
export const triggerVibration = () => {
    if (navigator.vibrate) {
        // Vibrate for 200ms
        navigator.vibrate(200);
        console.log("Phone vibration triggered");
    } else {
        console.log("Vibration API not supported on this device");
        // Fallback: show visual feedback
        return false;
    }
    return true;
};
