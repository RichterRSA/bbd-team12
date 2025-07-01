#!/bin/bash

# Startup script for BBD Team 12 application
# This script starts the backend, builds and starts the frontend, and configures nginx

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
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to wait for a service to be ready
wait_for_service() {
    local port=$1
    local service_name=$2
    local max_attempts=30
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

# Function to stop existing services
cleanup() {
    log "Stopping existing services..."
    
    # Stop nginx if running
    if pgrep nginx > /dev/null; then
        sudo nginx -s quit 2>/dev/null || sudo pkill nginx 2>/dev/null || true
        log "Stopped nginx"
    fi
    
    # Kill processes on our ports
    for port in 3000 8080; do
        if check_port $port; then
            warning "Port $port is in use, attempting to free it..."
            lsof -ti:$port | xargs kill -9 2>/dev/null || true
        fi
    done
    
    # Clean up any existing processes
    pkill -f "node.*server.js" 2>/dev/null || true
    pkill -f "next" 2>/dev/null || true
    
    sleep 2
}

# Function to install dependencies
install_dependencies() {
    log "Installing dependencies..."
    
    # Backend dependencies
    log "Installing backend dependencies..."
    cd "$PROJECT_ROOT/backend"
    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
        npm install
        success "Backend dependencies installed"
    else
        log "Backend dependencies are up to date"
    fi
    
    # Frontend dependencies
    log "Installing frontend dependencies..."
    cd "$PROJECT_ROOT/frontend"
    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
        npm install
        success "Frontend dependencies installed"
    else
        log "Frontend dependencies are up to date"
    fi
    
    cd "$PROJECT_ROOT"
}

# Function to build the backend
build_backend() {
    log "Building backend..."
    cd "$PROJECT_ROOT/backend"
    npm run build
    success "Backend built successfully"
    cd "$PROJECT_ROOT"
}

# Function to build the frontend
build_frontend() {
    log "Building frontend..."
    cd "$PROJECT_ROOT/frontend"
    npm run build
    success "Frontend built successfully"
    cd "$PROJECT_ROOT"
}

# Function to start the backend
start_backend() {
    log "Starting backend server..."
    cd "$PROJECT_ROOT/backend"
    
    # Start backend in background
    nohup npm start > ../logs/backend.log 2>&1 &
    BACKEND_PID=$!
    echo $BACKEND_PID > ../pids/backend.pid
    
    cd "$PROJECT_ROOT"
    
    # Wait for backend to be ready
    wait_for_service 8080 "Backend"
}

# Function to start the frontend
start_frontend() {
    log "Starting frontend server..."
    cd "$PROJECT_ROOT/frontend"
    
    # Start frontend in background
    nohup npm start > ../logs/frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > ../pids/frontend.pid
    
    cd "$PROJECT_ROOT"
    
    # Wait for frontend to be ready
    wait_for_service 3000 "Frontend"
}

# Function to start nginx
start_nginx() {
    log "Starting nginx..."
    
    # Test nginx configuration
    sudo nginx -t -c "$PROJECT_ROOT/nginx.conf"
    
    # Start nginx
    sudo nginx -c "$PROJECT_ROOT/nginx.conf"
    
    success "Nginx started successfully"
}

# Function to check nginx installation
check_nginx() {
    if ! command -v nginx &> /dev/null; then
        error "nginx is not installed. Please install nginx first:"
        error "  Ubuntu/Debian: sudo apt-get install nginx"
        error "  CentOS/RHEL: sudo yum install nginx"
        error "  macOS: brew install nginx"
        exit 1
    fi
}

# Function to check Node.js installation
check_nodejs() {
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js first."
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        error "npm is not installed. Please install npm first."
        exit 1
    fi
}

# Function to create necessary directories
create_directories() {
    mkdir -p "$PROJECT_ROOT/logs"
    mkdir -p "$PROJECT_ROOT/pids"
}

# Function to display service status
show_status() {
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
    log "Application is available at: http://localhost"
    log "Logs are available in: $PROJECT_ROOT/logs/"
    log "To stop services, run: ./stop.sh"
}

# Main execution
main() {
    log "Starting BBD Team 12 Application..."
    
    # Check prerequisites
    check_nodejs
    check_nginx
    
    # Create necessary directories
    create_directories
    
    # Cleanup any existing services
    cleanup
    
    # Install dependencies
    install_dependencies
    
    # Build applications
    build_backend
    build_frontend
    
    # Start services
    start_backend
    start_frontend
    start_nginx
    
    # Show status
    show_status
    
    success "All services started successfully!"
    log "Press Ctrl+C to stop monitoring, or run ./stop.sh to stop all services"
    
    # Monitor services
    while true; do
        sleep 30
        if ! check_port 8080; then
            error "Backend service stopped unexpectedly!"
            break
        fi
        if ! check_port 3000; then
            error "Frontend service stopped unexpectedly!"
            break
        fi
        if ! pgrep nginx > /dev/null; then
            error "Nginx stopped unexpectedly!"
            break
        fi
    done
}

# Handle script interruption
trap 'log "Received interrupt signal. Services are still running. Use ./stop.sh to stop them."; exit 0' INT

# Run main function
main "$@"
