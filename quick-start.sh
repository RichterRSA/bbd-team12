#!/bin/bash

# Quick start script for BBD Team 12 application
# This script starts all services and exits, leaving them running in the background

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$SCRIPT_DIR"

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to check if a port is in use
check_port() {
    local port=$1
    if ss -tlnp | grep -q ":$port "; then
        return 0
    else
        return 1
    fi
}

# Function to wait for a service to be ready
wait_for_service() {
    local port=$1
    local service_name=$2
    local max_attempts=15
    local attempt=1
    
    log "Waiting for $service_name to be ready on port $port..."
    
    while [ $attempt -le $max_attempts ]; do
        if check_port $port; then
            success "$service_name is ready on port $port"
            return 0
        fi
        
        log "Attempt $attempt/$max_attempts: $service_name not ready yet..."
        sleep 2
        ((attempt++))
    done
    
    error "$service_name failed to start on port $port after $max_attempts attempts"
    return 1
}

# Create necessary directories
mkdir -p "$PROJECT_ROOT/logs"
mkdir -p "$PROJECT_ROOT/pids"

log "Starting BBD Team 12 Application (Quick Start)..."

# Start backend
if ! check_port 8080; then
    log "Starting backend server..."
    cd "$PROJECT_ROOT/backend"
    setsid nohup npm start > ../logs/backend.log 2>&1 < /dev/null &
    echo $! > ../pids/backend.pid
    cd "$PROJECT_ROOT"
    wait_for_service 8080 "Backend"
else
    success "Backend already running on port 8080"
fi

# Start frontend  
if ! check_port 3000; then
    log "Starting frontend server..."
    cd "$PROJECT_ROOT/frontend"
    setsid nohup npm start > ../logs/frontend.log 2>&1 < /dev/null &
    echo $! > ../pids/frontend.pid
    cd "$PROJECT_ROOT"
    wait_for_service 3000 "Frontend"
else
    success "Frontend already running on port 3000"
fi

# Start nginx if not running
if ! pgrep nginx > /dev/null; then
    log "Starting nginx..."
    nginx -c "$PROJECT_ROOT/nginx.conf"
    success "Nginx started successfully"
else
    success "Nginx already running"
fi

# Final status
log "Service Status:"
echo "=================================="

if check_port 8080; then
    success "✓ Backend running on http://localhost:8080"
else
    error "✗ Backend not running"
fi

if check_port 3000; then
    success "✓ Frontend running on http://localhost:3000"
else
    error "✗ Frontend not running"
fi

if pgrep nginx > /dev/null; then
    success "✓ Nginx running on http://localhost:80"
else
    error "✗ Nginx not running"
fi

echo "=================================="
success "Application is available at: http://localhost"
log "Logs are available in: $PROJECT_ROOT/logs/"
log "To stop services, run: ./stop.sh"
log "To check status, run: ./status.sh"

success "All services started successfully and running in background!"
