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
    for port in 3000 3001; do
        if check_port $port; then
            warning "Port $port is in use, attempting to free it..."
            ss -tlnp | grep ":$port " | awk '{print $6}' | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs kill -9 2>/dev/null || true
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
    
    # Start backend in background with setsid for proper detachment
    setsid nohup npm start > ../logs/backend.log 2>&1 < /dev/null &
    BACKEND_PID=$!
    echo $BACKEND_PID > ../pids/backend.pid
    
    cd "$PROJECT_ROOT"
    
    # Wait for backend to be ready
    wait_for_service 3001 "Backend"
}

# Function to start the frontend
start_frontend() {
    log "Starting frontend server..."
    cd "$PROJECT_ROOT/frontend"
    
    # Start frontend in background with setsid for proper detachment
    setsid nohup npm start > ../logs/frontend.log 2>&1 < /dev/null &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > ../pids/frontend.pid
    
    cd "$PROJECT_ROOT"
    
    # Wait for frontend to be ready
    wait_for_service 3000 "Frontend"
}

# Function to start nginx
start_nginx() {
    log "Starting nginx..."
    
    # Choose configuration based on SSL availability
    local nginx_config="$PROJECT_ROOT/nginx-http.conf"
    local cert_file="/etc/ssl/certs/localhost.pem"
    local key_file="/etc/ssl/private/localhost-key.pem"
    
    if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
        nginx_config="$PROJECT_ROOT/nginx.conf"
        log "Using HTTPS configuration (SSL certificates found)"
    else
        log "Using HTTP-only configuration (SSL certificates not found)"
    fi
    
    # Test nginx configuration
    sudo nginx -t -c "$nginx_config"
    
    # Start nginx
    sudo nginx -c "$nginx_config"
    
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

# Function to check SSL certificates
check_ssl() {
    local cert_file="/etc/ssl/certs/localhost.pem"
    local key_file="/etc/ssl/private/localhost-key.pem"
    
    if [ ! -f "$cert_file" ] || [ ! -f "$key_file" ]; then
        warning "SSL certificates not found!"
        log "HTTPS will not be available without SSL certificates."
        log "To set up SSL certificates, run: sudo ./setup-ssl.sh"
        
        read -p "Do you want to continue without HTTPS? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            error "SSL certificates required for HTTPS. Exiting."
            exit 1
        fi
        
        warning "Continuing without HTTPS support"
        return 1
    else
        success "SSL certificates found - HTTPS will be available"
        return 0
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
    
    if check_port 3001; then
        success "✓ Backend running on http://localhost:3001"
    else
        error "✗ Backend not running"
    fi
    
    if check_port 3000; then
        success "✓ Frontend running on http://localhost:3000"
    else
        error "✗ Frontend not running"
    fi
    
    if pgrep nginx > /dev/null; then
        success "✓ Nginx running"
        if ss -tlnp | grep -q ":443 "; then
            success "✓ HTTPS available on https://localhost:443"
            success "✓ HTTP redirects to HTTPS on http://localhost:80"
        else
            success "✓ HTTP available on http://localhost:80"
            warning "⚠ HTTPS not available (SSL certificates not configured)"
        fi
    else
        error "✗ Nginx not running"
    fi
    
    echo "=================================="
    if ss -tlnp | grep -q ":443 "; then
        log "Application is available at: https://localhost"
        log "(HTTP requests will redirect to HTTPS)"
    else
        log "Application is available at: http://localhost"
    fi
    log "Logs are available in: $PROJECT_ROOT/logs/"
    log "To stop services, run: ./stop.sh"
    log "To set up HTTPS, run: sudo ./setup-ssl.sh"
}

# Main execution
main() {
    log "Starting BBD Team 12 Application..."
    
    # Check prerequisites
    check_nodejs
    check_nginx
    
    # Check SSL certificates (optional)
    log "Checking SSL certificate availability..."
    check_ssl || log "Continuing without HTTPS support"
    
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
    log "Services are running in the background."
    log "Use ./status.sh to check service status"
    log "Use ./stop.sh to stop all services"
}

# Run main function
main "$@"
