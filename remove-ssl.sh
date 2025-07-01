#!/bin/bash

# SSL Certificate removal script for BBD Team 12 application
# This script removes SSL certificates and ensures HTTP-only configuration

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

# SSL directories and files
SSL_DIR="/etc/ssl"
CERT_DIR="$SSL_DIR/certs"
KEY_DIR="$SSL_DIR/private"
CERT_FILE="$CERT_DIR/localhost.pem"
KEY_FILE="$KEY_DIR/localhost-key.pem"

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Function to check if nginx is running
check_nginx_running() {
    if pgrep nginx > /dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to stop nginx safely
stop_nginx() {
    log "Stopping nginx..."
    if check_nginx_running; then
        nginx -s quit 2>/dev/null || pkill nginx 2>/dev/null || true
        sleep 2
        
        # Force kill if still running
        if check_nginx_running; then
            pkill -9 nginx 2>/dev/null || true
            sleep 1
        fi
        
        if ! check_nginx_running; then
            success "Nginx stopped successfully"
        else
            error "Failed to stop nginx"
            return 1
        fi
    else
        log "Nginx is not running"
    fi
}

# Function to remove SSL certificates
remove_ssl_certificates() {
    log "Removing SSL certificates..."
    
    local removed_files=()
    
    # Remove certificate file
    if [ -f "$CERT_FILE" ]; then
        rm -f "$CERT_FILE"
        removed_files+=("$CERT_FILE")
        log "Removed certificate: $CERT_FILE"
    fi
    
    # Remove private key file
    if [ -f "$KEY_FILE" ]; then
        rm -f "$KEY_FILE"
        removed_files+=("$KEY_FILE")
        log "Removed private key: $KEY_FILE"
    fi
    
    # Remove any backup files
    if ls "$CERT_DIR"/localhost*.pem* 2>/dev/null; then
        rm -f "$CERT_DIR"/localhost*.pem*
        log "Removed certificate backup files"
    fi
    
    if ls "$KEY_DIR"/localhost*.pem* 2>/dev/null; then
        rm -f "$KEY_DIR"/localhost*.pem*
        log "Removed private key backup files"
    fi
    
    if [ ${#removed_files[@]} -gt 0 ]; then
        success "SSL certificates removed successfully"
        log "Removed files:"
        for file in "${removed_files[@]}"; do
            echo "  - $file"
        done
    else
        log "No SSL certificates found to remove"
    fi
}

# Function to ensure HTTP-only nginx configuration
ensure_http_only_config() {
    log "Ensuring HTTP-only nginx configuration..."
    
    local http_config="$PROJECT_ROOT/nginx-http.conf"
    local https_config="$PROJECT_ROOT/nginx.conf"
    
    if [ ! -f "$http_config" ]; then
        error "HTTP-only configuration file not found: $http_config"
        return 1
    fi
    
    # Update server_name to localhost in the HTTP config if it's set to wildcard
    if grep -q "server_name _;" "$http_config"; then
        log "Updating server_name to localhost in HTTP configuration..."
        sed -i 's/server_name _;/server_name localhost;/' "$http_config"
        success "Updated server_name to localhost"
    fi
    
    success "HTTP-only configuration is ready: $http_config"
    log "This configuration will be used automatically when SSL certificates are not present"
}

# Function to clean up SSL-related processes
cleanup_ssl_processes() {
    log "Cleaning up SSL-related processes..."
    
    # Kill any processes that might be using SSL certificates
    pkill -f "openssl" 2>/dev/null || true
    
    success "SSL-related processes cleaned up"
}

# Function to verify SSL removal
verify_ssl_removal() {
    log "Verifying SSL removal..."
    
    local errors=0
    
    # Check if certificate files still exist
    if [ -f "$CERT_FILE" ]; then
        error "Certificate file still exists: $CERT_FILE"
        ((errors++))
    fi
    
    if [ -f "$KEY_FILE" ]; then
        error "Private key file still exists: $KEY_FILE"
        ((errors++))
    fi
    
    # Check for any remaining localhost SSL files
    if ls "$CERT_DIR"/localhost*.pem* 2>/dev/null; then
        error "SSL certificate backup files still exist in $CERT_DIR"
        ((errors++))
    fi
    
    if ls "$KEY_DIR"/localhost*.pem* 2>/dev/null; then
        error "SSL private key backup files still exist in $KEY_DIR"
        ((errors++))
    fi
    
    if [ $errors -eq 0 ]; then
        success "SSL removal verification completed successfully"
        return 0
    else
        error "SSL removal verification failed with $errors errors"
        return 1
    fi
}

# Function to show removal summary
show_removal_summary() {
    log "SSL Removal Summary:"
    echo "=================================="
    echo "✓ SSL certificates removed from system"
    echo "✓ HTTP-only nginx configuration ready"
    echo "✓ System configured for HTTP-only operation"
    echo ""
    log "Next steps:"
    echo "1. Start the application with: ./start.sh"
    echo "2. The application will run on HTTP only (no HTTPS)"
    echo "3. Access the application at: http://localhost"
    echo ""
    log "To re-enable SSL in the future:"
    echo "Run: sudo ./setup-ssl.sh"
    echo "=================================="
}

# Function to restart application in HTTP mode
restart_application() {
    log "Restarting application in HTTP-only mode..."
    
    cd "$PROJECT_ROOT"
    
    # Stop any running services
    if [ -f "./stop.sh" ]; then
        ./stop.sh 2>/dev/null || true
    fi
    
    sleep 2
    
    # Start services
    if [ -f "./start.sh" ]; then
        log "Starting application with HTTP-only configuration..."
        ./start.sh
    else
        warning "start.sh script not found. Please start the application manually."
    fi
}

# Main execution
main() {
    log "Starting SSL removal for BBD Team 12 Application..."
    
    check_root
    
    # Confirm removal
    warning "This will remove all SSL certificates and configure the application for HTTP-only operation."
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "SSL removal cancelled"
        exit 0
    fi
    
    # Stop nginx before making changes
    stop_nginx
    
    # Remove SSL certificates
    remove_ssl_certificates
    
    # Ensure HTTP-only configuration
    ensure_http_only_config
    
    # Clean up SSL processes
    cleanup_ssl_processes
    
    # Verify removal
    verify_ssl_removal
    
    # Show summary
    show_removal_summary
    
    # Ask if user wants to restart the application
    echo
    read -p "Do you want to restart the application in HTTP-only mode now? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        restart_application
    else
        log "Application not restarted. Run ./start.sh when ready."
    fi
    
    success "SSL removal completed successfully!"
}

# Run main function
main "$@"
