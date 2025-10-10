const dns = require('dns').promises;
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);

/**
 * Domain Service - Handles DNS verification, Nginx configuration, and SSL setup
 */
class DomainService {
  constructor() {
    this.serverIP = process.env.SERVER_IP ;
    this.email = process.env.EMAIL ;
    // Allow overriding Nginx paths via env; default to Linux standard locations
    this.nginxSitesAvailable = process.env.NGINX_SITES_AVAILABLE || '/etc/nginx/sites-available';
    this.nginxSitesEnabled = process.env.NGINX_SITES_ENABLED || '/etc/nginx/sites-enabled';
    this.appRoot = process.env.APP_ROOT;
    this.appPort = process.env.PORT;
    // Always manage Nginx/Certbot (user requested no skipping)
    this.manageNginx = true;
  }

  // Heuristic: treat two-label domains as apex (e.g., example.com). This won't
  // perfectly handle all public suffixes but is sufficient for common cases.
  isApexDomain(domain) {
    const parts = domain.split('.');
    return parts.length === 2;
  }

  /**
   * Verify DNS A record points to our server
   * @param {string} domain - Domain to check
   * @returns {Promise<boolean>} - True if DNS is correct
   */
  async verifyDNS(domain) {
    try {
      console.log(`🔍 Checking DNS for ${domain}...`);
      
      // Remove www prefix for DNS lookup
      const cleanDomain = domain.replace(/^www\./, '');
      
      // Resolve A record
      const addresses = await dns.resolve4(cleanDomain);
      
      console.log(`📡 DNS A records for ${cleanDomain}:`, addresses);
      
      // Check if any A record matches our server IP
      const isCorrect = addresses.includes(this.serverIP);
      
      if (isCorrect) {
        console.log(`✅ DNS verified for ${domain} -> ${this.serverIP}`);
      } else {
        console.log(`❌ DNS mismatch for ${domain}. Expected: ${this.serverIP}, Got: ${addresses.join(', ')}`);
      }
      
      return isCorrect;
    } catch (error) {
      console.error(`❌ DNS verification failed for ${domain}:`, error.message);
      return false;
    }
  }

  /**
   * Create Nginx configuration file for domain
   * @param {string} domain - Domain name
   * @param {string} siteSlug - Site slug to proxy to
   * @returns {Promise<boolean>} - Success status
   */
  async createNginxConfig(domain, siteSlug) {
    try {
      console.log(`🔧 Creating Nginx config for ${domain}...`);
      
      const configContent = this.generateNginxConfig(domain, siteSlug);
      const configPath = path.join(this.nginxSitesAvailable, domain);
      
      // Write Nginx configuration
      await fs.writeFile(configPath, configContent, 'utf8');
      console.log(`📝 Nginx config written to ${configPath}`);
      
      // Create symlink in sites-enabled
      const enabledPath = path.join(this.nginxSitesEnabled, domain);
      try {
        await fs.unlink(enabledPath); // Remove existing symlink if any
      } catch (error) {
        // Ignore if symlink doesn't exist
      }
      
      await fs.symlink(configPath, enabledPath);
      console.log(`🔗 Symlink created: ${enabledPath} -> ${configPath}`);
      
      // Test Nginx configuration
      await this.testNginxConfig();
      
      // Reload Nginx
      await this.reloadNginx();
      
      console.log(`✅ Nginx configuration completed for ${domain}`);
      return true;
    } catch (error) {
      console.error(`❌ Nginx configuration failed for ${domain}:`, error.message);
      return false;
    }
  }

  /**
   * Generate Nginx configuration content
   * @param {string} domain - Domain name
   * @param {string} siteSlug - Site slug
   * @returns {string} - Nginx config content
   */
  generateNginxConfig(domain, siteSlug) {
    const isApex = this.isApexDomain(domain);
    const serverNames = isApex ? `${domain} www.${domain}` : `${domain}`;
    return `# Auto-generated Nginx config for ${domain}
# Generated at: ${new Date().toISOString()}

server {
    listen 80;
    server_name ${serverNames};
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # Proxy to Node.js application
    location / {
        proxy_pass http://127.0.0.1:${this.appPort}/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffer settings
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;
    }
    
    # Handle static assets
    location /cloned-sites/ {
        alias ${this.appRoot}/cloned_sites/;
        expires 1y;
        add_header Cache-Control "public, immutable";
        
        # Security for static files
        location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }
    
    # Deny access to sensitive files
    location ~ /\\. {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    # Deny access to backup files
    location ~* \\.(bak|backup|old|orig|original|tmp)$ {
        deny all;
        access_log off;
        log_not_found off;
    }
}
`;
  }

  /**
   * Test Nginx configuration syntax
   * @returns {Promise<boolean>} - Success status
   */
  async testNginxConfig() {
    try {
      console.log('🧪 Testing Nginx configuration...');
      const { stdout, stderr } = await execAsync('sudo nginx -t');
      
      if (stderr && !stderr.includes('test is successful')) {
        throw new Error(`Nginx config test failed: ${stderr}`);
      }
      
      console.log('✅ Nginx configuration test passed');
      return true;
    } catch (error) {
      console.error('❌ Nginx configuration test failed:', error.message);
      throw error;
    }
  }

  /**
   * Reload Nginx configuration
   * @returns {Promise<boolean>} - Success status
   */
  async reloadNginx() {
    try {
      console.log('🔄 Reloading Nginx...');
      const { stdout, stderr } = await execAsync('sudo nginx -s reload');
      
      if (stderr) {
        console.warn('Nginx reload warning:', stderr);
      }
      
      console.log('✅ Nginx reloaded successfully');
      return true;
    } catch (error) {
      console.error('❌ Nginx reload failed:', error.message);
      throw error;
    }
  }

  /**
   * Issue SSL certificate using Certbot
   * @param {string} domain - Domain name
   * @returns {Promise<boolean>} - Success status
   */
  async issueSSLCertificate(domain) {
    try {
      console.log(`🔒 Issuing SSL certificate for ${domain}...`);
      const isApex = this.isApexDomain(domain);
      const domainsArgs = isApex ? [`-d ${domain}`, `-d www.${domain}`] : [`-d ${domain}`];
      const certbotCommand = [
        'sudo certbot',
        '--nginx',
        '--redirect',
        ...domainsArgs,
        '--non-interactive',
        '--agree-tos',
        `-m ${this.email}`,
        '--expand'
      ].join(' ');
      
      console.log(`🔧 Running: ${certbotCommand}`);
      
      const { stdout, stderr } = await execAsync(certbotCommand);
      
      console.log('📋 Certbot output:', stdout);
      if (stderr) {
        console.warn('⚠️ Certbot warnings:', stderr);
      }
      
      // Check if certificate was issued successfully
      const success = stdout.includes('Successfully deployed certificate') || 
                     stdout.includes('Certificate not yet due for renewal');
      
      if (success) {
        console.log(`✅ SSL certificate issued successfully for ${domain}`);
        
        // Get certificate expiry date
        const expiryDate = await this.getCertificateExpiry(domain);
        if (expiryDate) {
          console.log(`📅 Certificate expires: ${expiryDate}`);
        }
        
        return true;
      } else {
        throw new Error('SSL certificate issuance failed');
      }
    } catch (error) {
      console.error(`❌ SSL certificate issuance failed for ${domain}:`, error.message);
      return false;
    }
  }

  /**
   * Get SSL certificate expiry date
   * @param {string} domain - Domain name
   * @returns {Promise<Date|null>} - Expiry date or null
   */
  async getCertificateExpiry(domain) {
    try {
      const { stdout } = await execAsync(`sudo certbot certificates -d ${domain}`);
      
      // Parse expiry date from certbot output
      const expiryMatch = stdout.match(/Expiry Date: (.+)/);
      if (expiryMatch) {
        return new Date(expiryMatch[1]);
      }
      
      return null;
    } catch (error) {
      console.warn(`⚠️ Could not get certificate expiry for ${domain}:`, error.message);
      return null;
    }
  }

  /**
   * Remove domain configuration (Nginx + SSL)
   * @param {string} domain - Domain name
   * @returns {Promise<boolean>} - Success status
   */
  async removeDomainConfig(domain) {
    try {
      console.log(`🗑️ Removing configuration for ${domain}...`);

      // Remove SSL certificate
      try {
        await execAsync(`sudo certbot delete --cert-name ${domain} --non-interactive`);
        console.log(`🔒 SSL certificate removed for ${domain}`);
      } catch (error) {
        console.warn(`⚠️ SSL removal warning for ${domain}:`, error.message);
      }
      
      // Remove Nginx configuration
      const configPath = path.join(this.nginxSitesAvailable, domain);
      const enabledPath = path.join(this.nginxSitesEnabled, domain);
      
      try {
        await fs.unlink(enabledPath);
        console.log(`🔗 Removed symlink: ${enabledPath}`);
      } catch (error) {
        console.warn(`⚠️ Symlink removal warning:`, error.message);
      }
      
      try {
        await fs.unlink(configPath);
        console.log(`📝 Removed config file: ${configPath}`);
      } catch (error) {
        console.warn(`⚠️ Config file removal warning:`, error.message);
      }
      
      // Reload Nginx
      await this.reloadNginx();
      
      console.log(`✅ Domain configuration removed for ${domain}`);
      return true;
    } catch (error) {
      console.error(`❌ Domain removal failed for ${domain}:`, error.message);
      return false;
    }
  }

  /**
   * Renew SSL certificates for expiring domains
   * @param {Array} domains - Array of domain names
   * @returns {Promise<Object>} - Renewal results
   */
  async renewSSLCertificates(domains) {
    const results = {
      successful: [],
      failed: [],
      skipped: []
    };
    
    for (const domain of domains) {
      try {
        console.log(`🔄 Renewing SSL certificate for ${domain}...`);
        
        const { stdout, stderr } = await execAsync(`sudo certbot renew --cert-name ${domain} --non-interactive`);
        
        if (stdout.includes('not yet due for renewal')) {
          results.skipped.push(domain);
          console.log(`⏭️ Certificate for ${domain} not yet due for renewal`);
        } else if (stdout.includes('Successfully deployed certificate')) {
          results.successful.push(domain);
          console.log(`✅ Certificate renewed for ${domain}`);
        } else {
          results.failed.push(domain);
          console.log(`❌ Certificate renewal failed for ${domain}`);
        }
      } catch (error) {
        results.failed.push(domain);
        console.error(`❌ SSL renewal error for ${domain}:`, error.message);
      }
    }
    
    return results;
  }

  /**
   * Get domain status information
   * @param {string} domain - Domain name
   * @returns {Promise<Object>} - Domain status     
   */
  async getDomainStatus(domain) {
    try {
      const status = {
        domain,
        dns: false,
        nginx: false,
        ssl: false,
        sslExpiry: null,
        lastChecked: new Date()
      };
      
      // Check DNS
      status.dns = await this.verifyDNS(domain);
      
      // Check Nginx config
      try {
        await fs.access(path.join(this.nginxSitesEnabled, domain));
        status.nginx = true;
      } catch (error) {
        status.nginx = false;
      }
      
      // Check SSL certificate
      try {
        const expiryDate = await this.getCertificateExpiry(domain);
        if (expiryDate) {
          status.ssl = true;
          status.sslExpiry = expiryDate;
        }
      } catch (error) {
        status.ssl = false;
      }
      
      return status;
    } catch (error) {
      console.error(`❌ Domain status check failed for ${domain}:`, error.message);
      return {
        domain,
        dns: false,
        nginx: false,
        ssl: false,
        error: error.message,
        lastChecked: new Date()
      };
    }
  }
}

module.exports = DomainService;
