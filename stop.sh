#!/bin/bash

# Stop script for BBD Team 12 application
# This script stops the backend, frontend, and nginx services

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

# Function to stop nginx
stop_nginx() {
    log "Stopping nginx..."
    
    if pgrep nginx > /dev/null; then
        sudo nginx -s quit 2>/dev/null || sudo pkill nginx 2>/dev/null || true
        sleep 2
        
        if pgrep nginx > /dev/null; then
            warning "Nginx still running, force killing..."
            sudo pkill -9 nginx 2>/dev/null || true
        fi
        
        success "Nginx stopped"
    else
        log "Nginx is not running"
    fi
}

# Function to stop backend
stop_backend() {
    log "Stopping backend server..."
    
    # Stop using PID file if available
    if [ -f "$PROJECT_ROOT/pids/backend.pid" ]; then
        local pid=$(cat "$PROJECT_ROOT/pids/backend.pid")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            sleep 2
            
            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                warning "Backend still running, force killing..."
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
        rm -f "$PROJECT_ROOT/pids/backend.pid"
    fi
    
    # Kill any remaining processes on port 8080
    if check_port 8080; then
        warning "Port 8080 still in use, killing processes..."
        ss -tlnp | grep ":8080 " | awk '{print $6}' | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs kill -9 2>/dev/null || true
    fi
    
    # Kill any node processes running server.js
    pkill -f "node.*server.js" 2>/dev/null || true
    
    success "Backend stopped"
}

# Function to stop frontend
stop_frontend() {
    log "Stopping frontend server..."
    
    # Stop using PID file if available
    if [ -f "$PROJECT_ROOT/pids/frontend.pid" ]; then
        local pid=$(cat "$PROJECT_ROOT/pids/frontend.pid")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            sleep 2
            
            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                warning "Frontend still running, force killing..."
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
        rm -f "$PROJECT_ROOT/pids/frontend.pid"
    fi
    
    # Kill any remaining processes on port 3000
    if check_port 3000; then
        warning "Port 3000 still in use, killing processes..."
        ss -tlnp | grep ":3000 " | awk '{print $6}' | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs kill -9 2>/dev/null || true
    fi
    
    # Kill any next.js processes
    pkill -f "next" 2>/dev/null || true
    
    success "Frontend stopped"
}

# Function to clean up temporary files
cleanup() {
    log "Cleaning up temporary files..."
    
    # Remove PID files
    rm -f "$PROJECT_ROOT/pids/backend.pid"
    rm -f "$PROJECT_ROOT/pids/frontend.pid"
    
    # Clean up log files if they're too large (over 100MB)
    if [ -f "$PROJECT_ROOT/logs/backend.log" ]; then
        local size=$(du -m "$PROJECT_ROOT/logs/backend.log" | cut -f1)
        if [ "$size" -gt 100 ]; then
            warning "Backend log file is large (${size}MB), truncating..."
            echo "" > "$PROJECT_ROOT/logs/backend.log"
        fi
    fi
    
    if [ -f "$PROJECT_ROOT/logs/frontend.log" ]; then
        local size=$(du -m "$PROJECT_ROOT/logs/frontend.log" | cut -f1)
        if [ "$size" -gt 100 ]; then
            warning "Frontend log file is large (${size}MB), truncating..."
            echo "" > "$PROJECT_ROOT/logs/frontend.log"
        fi
    fi
    
    success "Cleanup completed"
}

# Function to display final status
show_final_status() {
    log "Final Service Status:"
    echo "=================================="
    
    if check_port 8080; then
        error "✗ Backend still running on port 8080"
    else
        success "✓ Backend stopped"
    fi
    
    if check_port 3000; then
        error "✗ Frontend still running on port 3000"
    else
        success "✓ Frontend stopped"
    fi
    
    if pgrep nginx > /dev/null; then
        error "✗ Nginx still running"
    else
        success "✓ Nginx stopped"
    fi
    
    echo "=================================="
}

# Main execution
main() {
    log "Stopping BBD Team 12 Application..."
    
    # Stop services in reverse order
    stop_nginx
    stop_frontend
    stop_backend
    
    # Clean up
    cleanup
    
    # Show final status
    show_final_status
    
    success "All services stopped successfully!"
}

# Run main function
main "$@"
