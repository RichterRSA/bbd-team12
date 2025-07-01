# BBD Team 12 Application Deployment

This repository contains scripts to deploy and run the BBD Team 12 application with both HTTP and HTTPS support using nginx as a reverse proxy.

## Quick Start

### Prerequisites
- Node.js and npm
- nginx
- OpenSSL (for HTTPS)

### Install nginx (if not already installed)
```bash
sudo apt update && sudo apt install nginx -y
```

### Start the application (HTTP only)
```bash
chmod +x *.sh
./quick-start.sh
```

### Set up HTTPS support
```bash
sudo ./setup-ssl.sh
./stop.sh
./start.sh
```

## Scripts Overview

### `start.sh`
Full startup script that:
- Installs dependencies
- Builds frontend and backend
- Starts all services
- Configures nginx with HTTP or HTTPS based on SSL certificate availability

### `quick-start.sh`
Simplified startup script that only starts services without rebuilding

### `stop.sh`
Stops all running services (frontend, backend, nginx)

### `status.sh`
Shows current status of all services and provides useful information

### `dev.sh`
Development mode script that runs services in development mode without nginx

### `setup-ssl.sh`
Generates self-signed SSL certificates for HTTPS support

## Service Ports

- **Frontend**: 3000 (Next.js)
- **Backend**: 3001 (Express + Socket.IO)
- **HTTP**: 80 (nginx proxy)
- **HTTPS**: 443 (nginx proxy with SSL)

## Application URLs

### HTTP Mode
- Main Application: http://localhost
- Direct Frontend: http://localhost:3000
- Direct Backend: http://localhost:3001

### HTTPS Mode
- Main Application: https://localhost
- HTTP requests redirect to HTTPS
- Direct Frontend: http://localhost:3000
- Direct Backend: http://localhost:3001

## SSL Certificate Setup

The application supports HTTPS using self-signed certificates for development. To set up SSL:

1. Run the SSL setup script:
   ```bash
   sudo ./setup-ssl.sh
   ```

2. Restart the application:
   ```bash
   ./stop.sh && ./start.sh
   ```

3. Access the application at https://localhost

**Note**: Browsers will show a security warning for self-signed certificates. Click "Advanced" and "Proceed to localhost" to continue.

## Configuration Files

### `nginx.conf`
Full nginx configuration with HTTPS support, including:
- HTTP to HTTPS redirection
- SSL/TLS configuration
- Proxy settings for frontend and backend
- Security headers
- Rate limiting

### `nginx-http.conf`
HTTP-only nginx configuration used when SSL certificates are not available

## Logs

Service logs are stored in the `logs/` directory:
- `backend.log` - Backend service logs
- `frontend.log` - Frontend service logs

View logs in real-time:
```bash
tail -f logs/backend.log
tail -f logs/frontend.log
```

## Troubleshooting

### Services not starting
1. Check if ports are already in use: `ss -tlnp | grep -E ":3000|:3001|:80|:443"`
2. Check logs: `./status.sh`
3. Restart services: `./stop.sh && ./start.sh`

### HTTPS not working
1. Verify SSL certificates exist: `ls -la /etc/ssl/certs/localhost.pem /etc/ssl/private/localhost-key.pem`
2. Regenerate certificates: `sudo ./setup-ssl.sh`
3. Test nginx configuration: `nginx -t -c nginx.conf`

### Permission issues
- SSL setup requires root privileges: `sudo ./setup-ssl.sh`
- nginx requires root to bind to ports 80/443

## Production Deployment

For production use:
1. Replace self-signed certificates with certificates from a trusted CA
2. Update `nginx.conf` with your domain name
3. Configure firewall rules for ports 80 and 443
4. Set up proper log rotation
5. Configure nginx to start automatically on boot

## Development

For development without nginx:
```bash
./dev.sh
```

This runs both frontend and backend in development mode with hot reloading.
