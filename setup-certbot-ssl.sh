#!/bin/bash

# Certbot SSL setup script for BBD Team 12 application with DuckDNS
# This script configures nginx for Certbot and obtains SSL certificates from Let's Encrypt

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

# Configuration
DOMAIN="bbd12.duckdns.org"
DUCKDNS_TOKEN="276393f1-a2ee-44f2-bdb9-75ff1a90d401"
EMAIL="admin@bbd12.duckdns.org"  # Change this to your email
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

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if nginx is installed
    if ! command -v nginx &> /dev/null; then
        error "nginx is not installed. Please install nginx first:"
        error "  Ubuntu/Debian: sudo apt-get install nginx"
        exit 1
    fi
    
    # Check if certbot is installed
    if ! command -v certbot &> /dev/null; then
        log "Installing certbot..."
        apt-get update
        apt-get install -y certbot python3-certbot-nginx
        success "Certbot installed successfully"
    else
        log "Certbot is already installed"
    fi
    
    success "Prerequisites check completed"
}

# Create webroot directory
create_webroot() {
    log "Creating webroot directory..."
    mkdir -p "$WEBROOT"
    chown -R www-data:www-data "$WEBROOT"
    chmod -R 755 "$WEBROOT"
    success "Webroot directory created at $WEBROOT"
}

# Stop existing nginx
stop_nginx() {
    log "Stopping existing nginx processes..."
    if pgrep nginx > /dev/null; then
        nginx -s quit 2>/dev/null || pkill nginx 2>/dev/null || true
        sleep 2
    fi
    success "Nginx stopped"
}

# Configure nginx for certbot
configure_nginx() {
    log "Configuring nginx for Certbot..."
    
    # Backup existing nginx config if it exists
    if [ -f "/etc/nginx/nginx.conf" ]; then
        cp "/etc/nginx/nginx.conf" "/etc/nginx/nginx.conf.backup.$(date +%Y%m%d_%H%M%S)"
        log "Backed up existing nginx configuration"
    fi
    
    # Use our certbot-ready configuration
    cp "$PROJECT_ROOT/nginx-certbot.conf" "/etc/nginx/nginx.conf"
    
    # Test nginx configuration
    nginx -t
    success "Nginx configuration updated and tested"
}

# Start nginx
start_nginx() {
    log "Starting nginx..."
    systemctl start nginx
    systemctl enable nginx
    success "Nginx started and enabled"
}

# Test domain accessibility
test_domain() {
    log "Testing domain accessibility..."
    
    # Create a test file
    echo "ACME challenge test" > "$WEBROOT/test.txt"
    
    # Test if domain is accessible
    if curl -f -s "http://$DOMAIN/test.txt" > /dev/null; then
        success "Domain $DOMAIN is accessible"
        rm -f "$WEBROOT/test.txt"
        return 0
    else
        warning "Domain $DOMAIN is not accessible from the internet"
        rm -f "$WEBROOT/test.txt"
        return 1
    fi
}

# Obtain SSL certificate
obtain_certificate() {
    log "Obtaining SSL certificate from Let's Encrypt..."
    
    # Use webroot method for domain verification
    certbot certonly \
        --webroot \
        --webroot-path="$WEBROOT" \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        --domains "$DOMAIN" \
        --non-interactive
    
    if [ $? -eq 0 ]; then
        success "SSL certificate obtained successfully"
    else
        error "Failed to obtain SSL certificate"
        return 1
    fi
}

# Configure nginx with SSL
configure_ssl_nginx() {
    log "Configuring nginx with SSL..."
    
    # Create SSL-enabled configuration
    cat > /etc/nginx/nginx.conf << EOF
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    
    # Logging
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/javascript
        application/xml+rss
        application/json;

    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=api:10m rate=10r/s;
    
    upstream backend {
        server 127.0.0.1:8080;
    }
    
    upstream frontend {
        server 127.0.0.1:3000;
    }
    
    # HTTP server - redirect to HTTPS
    server {
        listen 80;
        server_name $DOMAIN;
        
        # ACME challenge location for certificate renewal
        location /.well-known/acme-challenge/ {
            root $WEBROOT;
            try_files \$uri =404;
        }
        
        # Redirect all other HTTP traffic to HTTPS
        location / {
            return 301 https://\$server_name\$request_uri;
        }
    }
    
    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name $DOMAIN;
        
        # SSL Configuration
        ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
        
        # Modern SSL configuration
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA256:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:DHE-RSA-AES128-SHA256:DHE-RSA-AES256-SHA256:DHE-RSA-AES128-SHA:DHE-RSA-AES256-SHA;
        ssl_prefer_server_ciphers on;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 10m;
        
        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        
        # Frontend routes
        location / {
            proxy_pass http://frontend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_cache_bypass \$http_upgrade;
            proxy_read_timeout 86400;
        }
        
        # Backend API routes
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://backend/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_cache_bypass \$http_upgrade;
            proxy_read_timeout 86400;
        }
        
        # Socket.IO routes
        location /socket.io/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_cache_bypass \$http_upgrade;
        }
        
        # Health check endpoint
        location /health {
            access_log off;
            return 200 "healthy\\n";
            add_header Content-Type text/plain;
        }
    }
}
EOF
    
    # Test configuration
    nginx -t
    success "SSL nginx configuration created and tested"
}

# Reload nginx
reload_nginx() {
    log "Reloading nginx with SSL configuration..."
    systemctl reload nginx
    success "Nginx reloaded with SSL configuration"
}

# Setup auto-renewal
setup_renewal() {
    log "Setting up automatic certificate renewal..."
    
    # Create renewal hook script
    cat > /etc/letsencrypt/renewal-hooks/deploy/nginx-reload.sh << 'EOF'
#!/bin/bash
systemctl reload nginx
EOF
    
    chmod +x /etc/letsencrypt/renewal-hooks/deploy/nginx-reload.sh
    
    # Test renewal
    certbot renew --dry-run
    
    success "Automatic renewal configured and tested"
}

# Show final status
show_status() {
    log "SSL Setup Complete!"
    echo "=================================="
    success "✓ SSL certificate obtained for $DOMAIN"
    success "✓ Nginx configured with HTTPS"
    success "✓ HTTP traffic redirects to HTTPS"
    success "✓ Automatic renewal configured"
    echo ""
    log "Your application is now available at:"
    log "  https://$DOMAIN (HTTPS - recommended)"
    log "  http://$DOMAIN (redirects to HTTPS)"
    echo ""
    log "Certificate details:"
    certbot certificates | grep -A 5 "$DOMAIN"
    echo "=================================="
}

# Main execution
main() {
    log "Starting SSL setup with Let's Encrypt and DuckDNS..."
    
    check_root
    check_prerequisites
    create_webroot
    stop_nginx
    configure_nginx
    start_nginx
    
    # Test domain accessibility
    if ! test_domain; then
        error "Domain is not accessible. Please check:"
        error "1. DNS settings for $DOMAIN point to this server"
        error "2. Firewall allows HTTP traffic on port 80"
        error "3. DuckDNS configuration is correct"
        exit 1
    fi
    
    obtain_certificate
    configure_ssl_nginx
    reload_nginx
    setup_renewal
    show_status
    
    success "SSL setup completed successfully!"
}

# Run main function
main "$@"
