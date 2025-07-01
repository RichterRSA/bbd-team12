#!/bin/bash

# SSL Certificate generation script for BBD Team 12 application
# This script creates self-signed certificates for HTTPS support

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# SSL directories
SSL_DIR="/etc/ssl"
CERT_DIR="$SSL_DIR/certs"
KEY_DIR="$SSL_DIR/private"

# Certificate details
CERT_FILE="$CERT_DIR/localhost.pem"
KEY_FILE="$KEY_DIR/localhost-key.pem"
CERT_DAYS=365

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Create SSL directories
create_ssl_dirs() {
    log "Creating SSL directories..."
    mkdir -p "$CERT_DIR"
    mkdir -p "$KEY_DIR"
    chmod 755 "$CERT_DIR"
    chmod 700 "$KEY_DIR"
    success "SSL directories created"
}

# Generate SSL certificate
generate_certificate() {
    log "Generating self-signed SSL certificate..."
    
    # Get server hostname and IP
    local hostname=$(hostname)
    local server_ip=$(hostname -I | awk '{print $1}')
    
    log "Detected hostname: $hostname"
    log "Detected IP: $server_ip"
    
    # Create certificate configuration
    cat > /tmp/localhost.conf << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C=US
ST=Local
L=Local
O=BBD Team 12
OU=Development
CN=$hostname

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
DNS.3 = $hostname
DNS.4 = *.$hostname
IP.1 = 127.0.0.1
IP.2 = ::1
IP.3 = $server_ip
EOF

    # Generate private key and certificate
    openssl req -new -x509 -newkey rsa:2048 -sha256 -nodes \
        -keyout "$KEY_FILE" \
        -days $CERT_DAYS \
        -out "$CERT_FILE" \
        -config /tmp/localhost.conf \
        -extensions v3_req
    
    # Set proper permissions
    chmod 644 "$CERT_FILE"
    chmod 600 "$KEY_FILE"
    
    # Clean up
    rm -f /tmp/localhost.conf
    
    success "SSL certificate generated successfully"
}

# Verify certificate
verify_certificate() {
    log "Verifying SSL certificate..."
    
    if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
        # Check certificate details
        log "Certificate details:"
        openssl x509 -in "$CERT_FILE" -text -noout | grep -E "(Subject:|Not Before|Not After|DNS:|IP Address:)"
        
        # Verify certificate and key match
        cert_hash=$(openssl x509 -noout -modulus -in "$CERT_FILE" | openssl md5)
        key_hash=$(openssl rsa -noout -modulus -in "$KEY_FILE" | openssl md5)
        
        if [ "$cert_hash" = "$key_hash" ]; then
            success "Certificate and key match"
        else
            error "Certificate and key do not match"
            exit 1
        fi
        
        success "SSL certificate verification completed"
    else
        error "Certificate files not found"
        exit 1
    fi
}

# Show certificate info
show_info() {
    log "SSL Certificate Information:"
    echo "=================================="
    echo "Certificate: $CERT_FILE"
    echo "Private Key: $KEY_FILE"
    echo "Valid for: $CERT_DAYS days"
    echo ""
    log "To trust this certificate in your browser:"
    echo "1. Navigate to https://localhost"
    echo "2. Click 'Advanced' -> 'Proceed to localhost (unsafe)'"
    echo "3. Or add the certificate to your browser's trusted certificates"
    echo ""
    warning "This is a self-signed certificate for development only!"
    warning "For production, use certificates from a trusted CA."
    echo "=================================="
}

# Main execution
main() {
    log "Starting SSL certificate generation for BBD Team 12..."
    
    check_root
    create_ssl_dirs
    
    # Check if certificates already exist
    if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
        warning "SSL certificates already exist!"
        read -p "Do you want to regenerate them? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log "Using existing certificates"
            verify_certificate
            show_info
            exit 0
        fi
    fi
    
    generate_certificate
    verify_certificate
    show_info
    
    success "SSL setup completed successfully!"
}

# Run main function
main "$@"
