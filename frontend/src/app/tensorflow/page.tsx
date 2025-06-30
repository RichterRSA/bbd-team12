"use client";
import "@tensorflow/tfjs-backend-webgl";
import * as cocossd from "@tensorflow-models/coco-ssd";
import { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";

async function requestCameraPermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: true 
        });
        
        // Camera access granted
        console.log('Camera permission granted');
        
        // You can now use the stream for video display
        // Don't forget to stop the stream if you're just checking permissions
        stream.getTracks().forEach(track => track.stop());
        
        return true;
    } catch (error) {
        console.error('Camera permission denied or error:', error);
        
        return false;
    }
}

const loadModelAndDetect = async (webcamRef: React.RefObject<Webcam>) => {
    // Check if the ref and its current value exist
    if (!webcamRef.current?.video) {
        console.error("Webcam not ready");
        return;
    }

    const model = await cocossd.load();
    const predictions = await model.detect(webcamRef.current.video);

    console.log(predictions);
}

const drawDetections = (detections: cocossd.DetectedObject[], canvasRef: React.RefObject<HTMLCanvasElement | null>) => {
    const ctx = canvasRef.current?.getContext("2d");

    if (!ctx) {
        console.error("Canvas not ready");
        return;
    }
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    detections.forEach(prediction => {
        if(prediction.class !== "person") {
            return;
        }
        const [x, y, width, height] = prediction.bbox;
        const text = prediction.class;

        ctx.strokeStyle = "red";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        ctx.fillStyle = "red";
        ctx.fillText(text, x, y > 10 ? y - 5 : y + 10);
    }); 
};

export default function TensorFlow() {
    const [model, setModel] = useState<cocossd.ObjectDetection | null>(null);
    const webcamRef: React.RefObject<Webcam | null> = useRef(null);
    const canvasRef: React.RefObject<HTMLCanvasElement | null> = useRef(null);

    console.log("Requesting camera permission...");
    requestCameraPermission();
    console.log("Camera permission requested");

    setInterval(async () => {
        if (!webcamRef.current?.video) {
            console.log("Webcam not ready");
            return;
        }
        if (webcamRef.current && webcamRef.current.video.readyState === 4) {
            const detections = await model!.detect(webcamRef.current.video);
            drawDetections(detections, canvasRef);
        }
    }, 1000); // Adjust the interval as needed
    
    useEffect(() => {
        async function loadModel() {
            const cocossdModel = await cocossd.load();
            setModel(cocossdModel);
        }
        
        if (model === null) {
            loadModel();
        }
    }, [model]);

    return (
        <div>
            {model ? 
            <div>
                <Webcam
                    audio={false}
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    style={{
                        width: "300px",
                        height: "300px",
                    }}
                    videoConstraints={{
                        facingMode: "environment",
                        width: 300,
                        height: 300,
                    }}
                />
                <canvas
                    ref={canvasRef}
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "300px",
                        height: "300px",
                    }}
                />  
            </div>
             : <p>Loading model...</p>}
        </div>
    );
}