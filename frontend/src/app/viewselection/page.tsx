"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export default function QRRevivePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [qrScanner, setQrScanner] = useState<QrScanner | null>(null);
  const [scanned, setScanned] = useState(false);
  const [generatedQR, setGeneratedQR] = useState("");

  const textToEncode = "RevivePlayerToken123";

  // 1️⃣ Generate QR code
  useEffect(() => {
    QRCode.toDataURL(textToEncode)
      .then(setGeneratedQR)
      .catch(console.error);
  }, []);

  // 2️⃣ Start scanner
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const scanner = new QrScanner(
      video,
      (result) => {
        console.log("QR Detected:", result.data);

        if (result.data === textToEncode && !scanned) {
          setScanned(true);
          scanner.stop();
        }
      },
      {
        highlightScanRegion: true,
        preferredCamera: "environment",
      }
    );

    scanner.start().catch(console.error);
    setQrScanner(scanner);

    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, [scanned]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gray-100">
      <h1 className="text-2xl font-bold mb-6">Player Revive QR Scanner</h1>

      {/* QR Generator */}
      <div className="mb-4 text-center">
        <p className="font-medium text-gray-700 mb-2">Scan this QR to revive:</p>
        {generatedQR && (
          <img
            src={generatedQR}
            alt="Generated QR"
            className="w-48 h-48 border rounded"
          />
        )}
      </div>

      {/* QR Scanner View */}
      {!scanned && (
        <video
          ref={videoRef}
          className="w-72 h-72 rounded shadow border mb-4"
        />
      )}

      {/* Revival Message */}
      {scanned && (
        <div className="animate-bounce text-green-600 text-2xl font-bold mt-6">
          ✅ Player Revived!
        </div>
      )}
    </div>
  );
}
