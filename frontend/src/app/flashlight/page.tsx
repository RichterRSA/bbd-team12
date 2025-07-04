// app/flash-toggle/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';

// Extend MediaTrackCapabilities to include torch property
declare global {
  interface MediaTrackCapabilities {
    torch?: boolean;
  }
}

export default function FlashTogglePage() {
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);

  useEffect(() => {
    let localStream: MediaStream | null = null;
    async function getCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        setMediaStream(stream);
        localStream = stream;
        const videoTrack = stream.getVideoTracks()[0];
        setTrack(videoTrack);
      } catch (err) {
        console.error('Error accessing camera:', err);
      }
    }

    getCamera();

    return () => {
      localStream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const toggleFlash = async () => {
    if (!track) return;

    const capabilities = track.getCapabilities();
    if (!capabilities.torch) {
      alert('Torch/flash is not supported on this device.');
      return;
    }

    try {
      await track.applyConstraints({
        advanced: [{ torch: true }] as any,
      } as any);
      setFlashOn(true);

      setTimeout(async () => {
        await track.applyConstraints({
          advanced: [{ torch: false }] as any,
        } as any);
        setFlashOn(false);
      }, 200); 
    } catch (error) {
      console.error('Error toggling flash:', error);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4">
      <button
        onClick={toggleFlash}
        className={`px-6 py-3 text-white rounded-md transition-all ${
          flashOn ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
        }`}
      >
        {flashOn ? 'Turn Flash Off' : 'Turn Flash On'}
      </button>
    </div>
  );
}
