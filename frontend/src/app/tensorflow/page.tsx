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

const drawDetections = (detections: cocossd.DetectedObject[], canvasRef: React.RefObject<HTMLCanvasElement | null>, webcamRef: React.RefObject<Webcam | null>) => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = webcamRef.current?.video;

    if (!ctx || !video) {
        console.error("Canvas or video not ready");
        return;
    }

    // Set canvas dimensions to match the displayed video
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get the actual video dimensions and displayed dimensions
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;

    // Set canvas size to match the displayed video
    canvas.width = displayWidth;
    canvas.height = displayHeight;

    // Calculate scaling factors
    const scaleX = displayWidth / videoWidth;
    const scaleY = displayHeight / videoHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    detections.forEach(prediction => {
        if(prediction.class !== "person") {
            return;
        }
        
        const [x, y, width, height] = prediction.bbox;
        
        // Scale the coordinates to match the displayed video size
        const scaledX = x * scaleX;
        const scaledY = y * scaleY;
        const scaledWidth = width * scaleX;
        const scaledHeight = height * scaleY;
        
        const text = prediction.class;

        ctx.strokeStyle = "red";
        ctx.lineWidth = 2;
        ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);
        ctx.fillStyle = "red";
        ctx.font = "16px Arial";
        ctx.fillText(text, scaledX, scaledY > 20 ? scaledY - 5 : scaledY + 20);
    }); 
};

export default function TensorFlow() {
    const [model, setModel] = useState<cocossd.ObjectDetection | null>(null);
    const webcamRef: React.RefObject<Webcam | null> = useRef(null);
    const canvasRef: React.RefObject<HTMLCanvasElement | null> = useRef(null);

    requestCameraPermission();

    setInterval(async () => {
        if (!webcamRef.current?.video) {
            return;
        }
        if (webcamRef.current && webcamRef.current.video.readyState === 4) {
            const detections = await model!.detect(webcamRef.current.video);
            drawDetections(detections, canvasRef, webcamRef);
        }
    }, 100); // Adjust the interval as needed
    
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
                        pointerEvents: "none", // Allow clicks to pass through to video
                    }}
                />  
            </div>
             : <p>Loading model...</p>}
        </div>
    );
}