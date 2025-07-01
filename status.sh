#!/bin/bash

# Status script for BBD Team 12 application
# This script checks the status of all services

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

# Function to get process info for a port
get_process_info() {
    local port=$1
    lsof -Pi :$port -sTCP:LISTEN -t 2>/dev/null | head -1 | xargs ps -p 2>/dev/null | tail -n +2
}

# Function to check service health
check_service_health() {
    local service_name=$1
    local port=$2
    local health_url=$3
    
    echo "  Service: $service_name"
    
    if check_port $port; then
        success "  ✓ Running on port $port"
        
        # Show process info
        local process_info=$(get_process_info $port)
        if [ -n "$process_info" ]; then
            echo "    Process: $process_info"
        fi
        
        # Check health endpoint if provided
        if [ -n "$health_url" ]; then
            if curl -s "$health_url" > /dev/null 2>&1; then
                success "  ✓ Health check passed"
            else
                warning "  ⚠ Health check failed"
            fi
        fi
    else
        error "  ✗ Not running on port $port"
    fi
    echo
}

# Function to check log files
check_logs() {
    log "Log File Status:"
    echo "=================================="
    
    if [ -f "$PROJECT_ROOT/logs/backend.log" ]; then
        local backend_size=$(du -h "$PROJECT_ROOT/logs/backend.log" | cut -f1)
        local backend_lines=$(wc -l < "$PROJECT_ROOT/logs/backend.log")
        echo "  Backend log: $backend_size ($backend_lines lines)"
        
        # Show last few lines if there are errors
        if grep -q "ERROR\|Error\|error" "$PROJECT_ROOT/logs/backend.log" 2>/dev/null; then
            warning "  ⚠ Errors found in backend log"
            echo "  Last error:"
            grep "ERROR\|Error\|error" "$PROJECT_ROOT/logs/backend.log" | tail -1 | sed 's/^/    /'
        fi
    else
        echo "  Backend log: Not found"
    fi
    
    if [ -f "$PROJECT_ROOT/logs/frontend.log" ]; then
        local frontend_size=$(du -h "$PROJECT_ROOT/logs/frontend.log" | cut -f1)
        local frontend_lines=$(wc -l < "$PROJECT_ROOT/logs/frontend.log")
        echo "  Frontend log: $frontend_size ($frontend_lines lines)"
        
        # Show last few lines if there are errors
        if grep -q "ERROR\|Error\|error" "$PROJECT_ROOT/logs/frontend.log" 2>/dev/null; then
            warning "  ⚠ Errors found in frontend log"
            echo "  Last error:"
            grep "ERROR\|Error\|error" "$PROJECT_ROOT/logs/frontend.log" | tail -1 | sed 's/^/    /'
        fi
    else
        echo "  Frontend log: Not found"
    fi
    
    echo
}

# Function to check PID files
check_pids() {
    log "PID File Status:"
    echo "=================================="
    
    if [ -f "$PROJECT_ROOT/pids/backend.pid" ]; then
        local backend_pid=$(cat "$PROJECT_ROOT/pids/backend.pid")
        if kill -0 "$backend_pid" 2>/dev/null; then
            success "  ✓ Backend PID $backend_pid is running"
        else
            error "  ✗ Backend PID $backend_pid is not running"
        fi
    else
        echo "  Backend PID file: Not found"
    fi
    
    if [ -f "$PROJECT_ROOT/pids/frontend.pid" ]; then
        local frontend_pid=$(cat "$PROJECT_ROOT/pids/frontend.pid")
        if kill -0 "$frontend_pid" 2>/dev/null; then
            success "  ✓ Frontend PID $frontend_pid is running"
        else
            error "  ✗ Frontend PID $frontend_pid is not running"
        fi
    else
        echo "  Frontend PID file: Not found"
    fi
    
    echo
}

# Function to show quick actions
show_actions() {
    log "Quick Actions:"
    echo "=================================="
    echo "  Start services:  ./start.sh"
    echo "  Stop services:   ./stop.sh"
    echo "  View logs:       tail -f logs/backend.log"
    echo "                   tail -f logs/frontend.log"
    echo "  Restart:         ./stop.sh && ./start.sh"
    echo
}

# Main execution
main() {
    log "BBD Team 12 Application Status"
    echo "=================================="
    
    # Check services
    check_service_health "Backend" 8080 "http://localhost:8080/health"
    check_service_health "Frontend" 3000 "http://localhost:3000"
    
    # Check nginx
    echo "  Service: Nginx"
    if pgrep nginx > /dev/null; then
        success "  ✓ Running"
        if curl -s "http://localhost/health" > /dev/null 2>&1; then
            success "  ✓ Proxy health check passed"
        else
            warning "  ⚠ Proxy health check failed"
        fi
    else
        error "  ✗ Not running"
    fi
    echo
    
    # Check URLs
    log "Application URLs:"
    echo "=================================="
    if pgrep nginx > /dev/null; then
        success "  ✓ Main Application: http://localhost"
    else
        error "  ✗ Main Application: Not available (nginx not running)"
    fi
    
    if check_port 3000; then
        success "  ✓ Direct Frontend: http://localhost:3000"
    else
        error "  ✗ Direct Frontend: Not available"
    fi
    
    if check_port 8080; then
        success "  ✓ Direct Backend: http://localhost:8080"
    else
        error "  ✗ Direct Backend: Not available"
    fi
    echo
    
    # Check logs
    check_logs
    
    # Check PID files
    check_pids
    
    # Show actions
    show_actions
}

# Run main function
main "$@"
