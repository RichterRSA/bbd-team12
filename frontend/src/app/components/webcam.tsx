import React, { useRef, useEffect } from "react";
import Webcam from "react-webcam";

const WebcamComponent = () => {
    const webcamRef = useRef(null);

    return (
        <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
        />
    );
};