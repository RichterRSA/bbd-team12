#!/bin/bash

# Development script for BBD Team 12 application
# This script starts both frontend and backend in development mode without nginx

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

# Function to cleanup on exit
cleanup() {
    log "Shutting down development servers..."
    
    # Kill background processes
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    
    # Wait a moment for graceful shutdown
    sleep 2
    
    # Force kill if still running
    for port in 3000 8080; do
        if check_port $port; then
            ss -tlnp | grep ":$port " | awk '{print $6}' | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs kill -9 2>/dev/null || true
        fi
    done
    
    success "Development servers stopped"
    exit 0
}

# Function to install dependencies
install_dependencies() {
    log "Checking and installing dependencies..."
    
    # Backend dependencies
    cd "$PROJECT_ROOT/backend"
    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
        log "Installing backend dependencies..."
        npm install
    fi
    
    # Frontend dependencies
    cd "$PROJECT_ROOT/frontend"
    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
        log "Installing frontend dependencies..."
        npm install
    fi
    
    cd "$PROJECT_ROOT"
    success "Dependencies are up to date"
}

# Function to start backend in development mode
start_backend_dev() {
    log "Starting backend in development mode..."
    cd "$PROJECT_ROOT/backend"
    
    # Kill any existing process on port 8080
    if check_port 8080; then
        warning "Port 8080 is in use, killing existing process..."
        ss -tlnp | grep ":8080 " | awk '{print $6}' | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    
    # Start backend
    npm run dev &
    BACKEND_PID=$!
    
    cd "$PROJECT_ROOT"
    
    # Wait for backend to be ready
    local attempts=0
    while [ $attempts -lt 15 ]; do
        if check_port 8080; then
            success "Backend is ready on http://localhost:8080"
            return 0
        fi
        sleep 2
        ((attempts++))
        log "Waiting for backend... ($attempts/15)"
    done
    
    error "Backend failed to start"
    return 1
}

# Function to start frontend in development mode
start_frontend_dev() {
    log "Starting frontend in development mode..."
    cd "$PROJECT_ROOT/frontend"
    
    # Kill any existing process on port 3000
    if check_port 3000; then
        warning "Port 3000 is in use, killing existing process..."
        ss -tlnp | grep ":3000 " | awk '{print $6}' | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    
    # Start frontend
    npm run dev &
    FRONTEND_PID=$!
    
    cd "$PROJECT_ROOT"
    
    # Wait for frontend to be ready
    local attempts=0
    while [ $attempts -lt 20 ]; do
        if check_port 3000; then
            success "Frontend is ready on http://localhost:3000"
            return 0
        fi
        sleep 3
        ((attempts++))
        log "Waiting for frontend... ($attempts/20)"
    done
    
    error "Frontend failed to start"
    return 1
}

# Function to show development status
show_dev_status() {
    log "Development Environment Status:"
    echo "=================================="
    
    if check_port 8080; then
        success "✓ Backend: http://localhost:8080"
    else
        error "✗ Backend: Not running"
    fi
    
    if check_port 3000; then
        success "✓ Frontend: http://localhost:3000"
    else
        error "✗ Frontend: Not running"
    fi
    
    echo "=================================="
    log "Development servers are running!"
    log "Frontend: http://localhost:3000"
    log "Backend: http://localhost:8080"
    log "Press Ctrl+C to stop both servers"
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Main execution
main() {
    log "Starting BBD Team 12 Development Environment..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js first."
        exit 1
    fi
    
    # Install dependencies
    install_dependencies
    
    # Start services
    start_backend_dev
    start_frontend_dev
    
    # Show status
    show_dev_status
    
    # Keep script running and monitor services
    while true; do
        sleep 10
        
        # Check if services are still running
        if ! kill -0 $BACKEND_PID 2>/dev/null; then
            error "Backend process died unexpectedly"
            break
        fi
        
        if ! kill -0 $FRONTEND_PID 2>/dev/null; then
            error "Frontend process died unexpectedly"
            break
        fi
    done
}

# Run main function
main "$@"
