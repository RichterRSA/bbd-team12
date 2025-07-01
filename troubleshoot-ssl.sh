#!/bin/bash

# Certbot troubleshooting script for BBD Team 12 application
# This script helps diagnose and fix common SSL/Certbot issues

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN="bbd12.duckdns.org"
WEBROOT="/var/www/html"

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

# Check domain DNS resolution
check_dns() {
    log "Checking DNS resolution for $DOMAIN..."
    
    local resolved_ip=$(dig +short $DOMAIN)
    local server_ip=$(curl -s ipinfo.io/ip)
    
    if [ -z "$resolved_ip" ]; then
        error "Domain $DOMAIN does not resolve to any IP"
        return 1
    fi
    
    log "Domain resolves to: $resolved_ip"
    log "Server public IP: $server_ip"
    
    if [ "$resolved_ip" = "$server_ip" ]; then
        success "✓ DNS resolution is correct"
        return 0
    else
        warning "⚠ DNS resolution mismatch"
        log "The domain resolves to $resolved_ip but server IP is $server_ip"
        log "This may cause certificate validation to fail"
        return 1
    fi
}

# Check port accessibility
check_ports() {
    log "Checking port accessibility..."
    
    # Check if port 80 is open
    if nc -z -w5 $DOMAIN 80; then
        success "✓ Port 80 is accessible"
    else
        error "✗ Port 80 is not accessible from outside"
        return 1
    fi
    
    # Check if port 443 is open (if SSL is configured)
    if nc -z -w5 $DOMAIN 443; then
        success "✓ Port 443 is accessible"
    else
        warning "⚠ Port 443 is not accessible (normal if SSL not yet configured)"
    fi
}

# Check nginx configuration
check_nginx_config() {
    log "Checking nginx configuration..."
    
    if nginx -t 2>/dev/null; then
        success "✓ Nginx configuration is valid"
    else
        error "✗ Nginx configuration has errors:"
        nginx -t
        return 1
    fi
    
    # Check if nginx is running
    if systemctl is-active --quiet nginx; then
        success "✓ Nginx is running"
    else
        error "✗ Nginx is not running"
        return 1
    fi
}

# Test ACME challenge path
test_acme_challenge() {
    log "Testing ACME challenge path..."
    
    # Create test file
    mkdir -p "$WEBROOT/.well-known/acme-challenge"
    echo "test-acme-challenge" > "$WEBROOT/.well-known/acme-challenge/test"
    chown -R www-data:www-data "$WEBROOT"
    
    # Test local access
    if curl -f -s "http://localhost/.well-known/acme-challenge/test" > /dev/null; then
        success "✓ ACME challenge path accessible locally"
    else
        error "✗ ACME challenge path not accessible locally"
        rm -f "$WEBROOT/.well-known/acme-challenge/test"
        return 1
    fi
    
    # Test external access
    if curl -f -s "http://$DOMAIN/.well-known/acme-challenge/test" > /dev/null; then
        success "✓ ACME challenge path accessible externally"
    else
        error "✗ ACME challenge path not accessible externally"
        rm -f "$WEBROOT/.well-known/acme-challenge/test"
        return 1
    fi
    
    # Clean up
    rm -f "$WEBROOT/.well-known/acme-challenge/test"
}

# Check firewall settings
check_firewall() {
    log "Checking firewall settings..."
    
    if command -v ufw &> /dev/null; then
        log "UFW status:"
        ufw status
        
        if ufw status | grep -q "80.*ALLOW"; then
            success "✓ Port 80 is allowed in UFW"
        else
            warning "⚠ Port 80 may not be allowed in UFW"
            log "Run: sudo ufw allow 80"
        fi
        
        if ufw status | grep -q "443.*ALLOW"; then
            success "✓ Port 443 is allowed in UFW"
        else
            warning "⚠ Port 443 may not be allowed in UFW"
            log "Run: sudo ufw allow 443"
        fi
    else
        log "UFW not installed, checking iptables..."
        iptables -L | grep -E "(80|443)" || log "No specific rules found for ports 80/443"
    fi
}

# Check Let's Encrypt rate limits
check_rate_limits() {
    log "Checking Let's Encrypt certificate status..."
    
    if certbot certificates 2>/dev/null | grep -q "$DOMAIN"; then
        log "Existing certificates:"
        certbot certificates | grep -A 10 "$DOMAIN"
    else
        log "No existing certificates found for $DOMAIN"
    fi
    
    log "Note: Let's Encrypt has rate limits:"
    log "- 50 certificates per registered domain per week"
    log "- 5 failed validations per account, per hostname, per hour"
}

# Fix common issues
fix_permissions() {
    log "Fixing file permissions..."
    
    # Fix webroot permissions
    mkdir -p "$WEBROOT"
    chown -R www-data:www-data "$WEBROOT"
    chmod -R 755 "$WEBROOT"
    
    # Fix nginx config permissions
    chown root:root /etc/nginx/nginx.conf
    chmod 644 /etc/nginx/nginx.conf
    
    success "Permissions fixed"
}

# Clean up failed attempts
cleanup_failed_attempts() {
    log "Cleaning up failed certificate attempts..."
    
    # Remove any temporary files
    rm -rf /tmp/certbot-*
    rm -rf /var/lib/letsencrypt/.well-known
    
    # Clear nginx cache
    nginx -s reload 2>/dev/null || true
    
    success "Cleanup completed"
}

# Show detailed logs
show_logs() {
    log "Recent Certbot logs:"
    echo "=================================="
    tail -n 50 /var/log/letsencrypt/letsencrypt.log 2>/dev/null || log "No Certbot logs found"
    echo "=================================="
    
    log "Recent nginx error logs:"
    echo "=================================="
    tail -n 20 /var/log/nginx/error.log 2>/dev/null || log "No nginx error logs found"
    echo "=================================="
}

# Manual certificate test
manual_test() {
    log "Performing manual certificate test..."
    
    certbot certonly \
        --webroot \
        --webroot-path="$WEBROOT" \
        --domains "$DOMAIN" \
        --dry-run \
        --verbose
}

# Show help
show_help() {
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  check       Run all diagnostic checks"
    echo "  fix         Fix common permission issues"
    echo "  cleanup     Clean up failed attempts"
    echo "  logs        Show recent logs"
    echo "  test        Run manual certificate test"
    echo "  help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 check    # Run all diagnostic checks"
    echo "  $0 fix      # Fix permissions and cleanup"
}

# Main execution
main() {
    case "${1:-check}" in
        "check")
            log "Running SSL troubleshooting diagnostics..."
            echo "=================================="
            
            check_dns
            echo ""
            check_ports
            echo ""
            check_nginx_config
            echo ""
            test_acme_challenge
            echo ""
            check_firewall
            echo ""
            check_rate_limits
            
            echo "=================================="
            log "Diagnostic checks completed"
            ;;
        "fix")
            log "Fixing common SSL issues..."
            fix_permissions
            cleanup_failed_attempts
            success "Common issues fixed"
            ;;
        "cleanup")
            cleanup_failed_attempts
            ;;
        "logs")
            show_logs
            ;;
        "test")
            manual_test
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"
