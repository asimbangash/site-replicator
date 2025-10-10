# 🌐 Custom Domain Management Documentation

This document provides comprehensive instructions for setting up and using the One-Click Custom Domain Hosting feature in the Site Replicator application.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Usage](#usage)
6. [API Reference](#api-reference)
7. [Troubleshooting](#troubleshooting)
8. [Security Considerations](#security-considerations)

## 🎯 Overview

The Custom Domain Management feature allows users to:
- Connect their own domains/subdomains to cloned sites
- Automatically verify DNS configuration
- Set up Nginx reverse proxy
- Issue and manage SSL certificates with Let's Encrypt
- Monitor domain status and health

### 🔄 Complete Flow

1. **User adds DNS record** → Points domain to server IP
2. **User adds domain in app** → System saves domain mapping
3. **System verifies DNS** → Checks A record points to server
4. **System configures Nginx** → Creates reverse proxy configuration
5. **System issues SSL** → Uses Certbot for Let's Encrypt certificate
6. **Domain goes live** → HTTPS-enabled custom domain

## 🛠 Prerequisites

### Server Requirements

- **Ubuntu/Debian server** with root access
- **Node.js 18+** installed
- **MongoDB** installed and running
- **Nginx** installed and configured
- **Certbot** installed for SSL certificates

### Domain Requirements

- Domain registered with a DNS provider (GoDaddy, Cloudflare, etc.)
- Ability to add A records
- Domain not already in use

## 📦 Installation

### 1. Install Dependencies

```bash
# Install required npm packages
npm install mongoose node-cron

# Install system dependencies
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx
```

### 2. Configure Nginx

```bash
# Backup existing Nginx config
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup

# Ensure Nginx is running
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 3. Configure MongoDB

```bash
# Start MongoDB service
sudo systemctl start mongod
sudo systemctl enable mongod

# Create database (optional, will be created automatically)
mongo
use site-replicator
```

### 4. Environment Configuration

Copy the example environment file and configure:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=3000
SERVER_IP=172.245.168.61
APP_ROOT=/var/www/myapp

# MongoDB Configuration
MONGO_URI=mongodb://localhost:27017/site-replicator

# SSL Certificate Configuration
EMAIL=youremail@domain.com
```

## ⚙️ Configuration

### 1. Nginx Configuration

The system automatically creates Nginx configurations, but you may need to adjust the main Nginx config:

```nginx
# /etc/nginx/nginx.conf
http {
    include /etc/nginx/sites-enabled/*;
    
    # Default server block for unmatched domains
    server {
        listen 80 default_server;
        server_name _;
        return 444;
    }
}
```

### 2. Certbot Configuration

Ensure Certbot is properly configured:

```bash
# Test Certbot configuration
sudo certbot --nginx --dry-run -d example.com

# Check existing certificates
sudo certbot certificates
```

### 3. Firewall Configuration

```bash
# Allow HTTP and HTTPS traffic
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 3000  # Node.js app port
```

## 🚀 Usage

### 1. Access Domain Management

Navigate to: `http://your-server-ip:3000/domains`

### 2. Add a New Domain

1. **Add DNS Record**: In your domain registrar, add an A record:
   ```
   Type: A
   Name: @ (or subdomain name)
   Value: 172.245.168.61
   ```

2. **Select Site**: Choose which cloned site to connect to your domain

3. **Add Domain**: Enter your domain name and click "Add Domain"

4. **Automatic Setup**: The system will:
   - Verify DNS configuration
   - Create Nginx configuration
   - Issue SSL certificate
   - Activate the domain

### 3. Monitor Domain Status

The dashboard shows:
- **Total Domains**: Number of domains added
- **Connected**: Domains successfully configured
- **Pending**: Domains waiting for DNS verification
- **SSL Enabled**: Domains with active SSL certificates

### 4. Domain Actions

For each domain, you can:
- **Verify DNS**: Manually check DNS configuration
- **Renew SSL**: Renew SSL certificate
- **Remove**: Delete domain and all configuration

## 📚 API Reference

### Domain Management Endpoints

#### Add Domain
```http
POST /api/add-domain
Content-Type: application/json

{
  "domain": "example.com",
  "siteSlug": "site-1"
}
```

#### List Domains
```http
GET /api/domains
```

#### Get Domain Details
```http
GET /api/domains/:domain
```

#### Verify Domain DNS
```http
POST /api/domains/:domain/verify
```

#### Renew SSL Certificate
```http
POST /api/domains/:domain/renew-ssl
```

#### Remove Domain
```http
DELETE /api/domains/:domain
```

#### Check Pending Domains
```http
GET /api/domains/pending/check
```

#### Get Status Summary
```http
GET /api/domains/status/summary
```

### Response Formats

#### Success Response
```json
{
  "success": true,
  "domain": {
    "domain": "example.com",
    "siteSlug": "site-1",
    "connected": true,
    "ssl": true,
    "dnsVerified": true,
    "nginxConfigured": true,
    "sslExpiry": "2024-12-31T23:59:59.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Domain added and configured successfully"
}
```

#### Error Response
```json
{
  "success": false,
  "error": "Domain already exists"
}
```

## 🔧 Troubleshooting

### Common Issues

#### 1. DNS Verification Fails

**Problem**: Domain DNS not pointing to server IP

**Solution**:
- Check A record in domain registrar
- Wait for DNS propagation (up to 48 hours)
- Use `dig example.com` to verify DNS

#### 2. Nginx Configuration Errors

**Problem**: Nginx fails to reload

**Solution**:
```bash
# Test Nginx configuration
sudo nginx -t

# Check Nginx error logs
sudo tail -f /var/log/nginx/error.log

# Reload Nginx
sudo nginx -s reload
```

#### 3. SSL Certificate Issues

**Problem**: SSL certificate not issued

**Solution**:
```bash
# Check Certbot logs
sudo tail -f /var/log/letsencrypt/letsencrypt.log

# Manually issue certificate
sudo certbot --nginx -d example.com

# Check certificate status
sudo certbot certificates
```

#### 4. MongoDB Connection Issues

**Problem**: Cannot connect to MongoDB

**Solution**:
```bash
# Check MongoDB status
sudo systemctl status mongod

# Check MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log

# Restart MongoDB
sudo systemctl restart mongod
```

#### 5. Cron Jobs Not Running

**Problem**: Automatic domain checks not working

**Solution**:
```bash
# Check cron service status
sudo systemctl status cron

# Check cron logs
sudo tail -f /var/log/cron

# Restart cron service
sudo systemctl restart cron
```

### Debug Commands

```bash
# Check domain DNS
dig example.com
nslookup example.com

# Check Nginx configuration
sudo nginx -t
sudo nginx -T

# Check SSL certificates
sudo certbot certificates
openssl s_client -connect example.com:443

# Check MongoDB
mongo --eval "db.adminCommand('ismaster')"

# Check Node.js process
ps aux | grep node
netstat -tlnp | grep :3000
```

## 🔒 Security Considerations

### 1. Server Security

- **Firewall**: Configure UFW to only allow necessary ports
- **SSH**: Use key-based authentication
- **Updates**: Keep system packages updated
- **Monitoring**: Set up log monitoring and alerts

### 2. Domain Security

- **DNS**: Use DNS providers with DNSSEC support
- **SSL**: Monitor certificate expiry dates
- **Backups**: Regular backups of Nginx configs and certificates

### 3. Application Security

- **Environment Variables**: Keep sensitive data in `.env` file
- **Database**: Use MongoDB authentication
- **Logs**: Monitor application logs for suspicious activity

### 4. Rate Limiting

Consider implementing rate limiting for domain management endpoints:

```javascript
const rateLimit = require('express-rate-limit');

const domainLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10 // limit each IP to 10 requests per windowMs
});

app.use('/api/add-domain', domainLimiter);
```

## 📊 Monitoring and Maintenance

### 1. Health Checks

The system includes automatic health checks:
- DNS verification every 30 minutes
- SSL certificate monitoring daily
- Certificate renewal weekly
- Failed domain cleanup weekly

### 2. Log Monitoring

Monitor these logs:
- Application logs: `pm2 logs` or `node server.js`
- Nginx logs: `/var/log/nginx/access.log` and `/var/log/nginx/error.log`
- Certbot logs: `/var/log/letsencrypt/letsencrypt.log`
- MongoDB logs: `/var/log/mongodb/mongod.log`

### 3. Backup Strategy

Regular backups should include:
- MongoDB database
- Nginx configuration files
- SSL certificates
- Application code and environment

### 4. Performance Monitoring

Monitor:
- Server CPU and memory usage
- Nginx request rates
- MongoDB connection counts
- SSL certificate expiry dates

## 🆘 Support

For issues and questions:

1. Check the troubleshooting section above
2. Review application logs
3. Test with a simple domain first
4. Ensure all prerequisites are met
5. Verify server configuration

## 📝 Changelog

### Version 1.0.0
- Initial release of Custom Domain Management
- DNS verification
- Nginx configuration
- SSL certificate management
- Cron job automation
- Web interface
- API endpoints

---

**Note**: This feature requires root access to the server for Nginx and Certbot operations. Ensure proper security measures are in place.
