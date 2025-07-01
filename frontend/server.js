const express = require('express');
const next = require('next');
const https = require('https');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0'; // Changed to allow external connections in Docker
const port = process.env.PORT || 3000;

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express();

  // Handle all requests with Next.js
  server.all('*', (req, res) => {
    return handle(req, res);
  });

  // Read SSL certificates
  const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, 'certificates', 'localhost-key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certificates', 'localhost.pem')),
  };

  // Create HTTPS server
  const httpsServer = https.createServer(httpsOptions, server);

  httpsServer.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on https://${hostname}:${port}`);
  });
});
