const express = require('express');
const mongoose = require('mongoose');
const Domain = require('../models/Domain');
const DomainService = require('../services/domain-service');

const router = express.Router();
const domainService = new DomainService();

/**
 * Connect to MongoDB
 */
async function connectDB() {
  try {
    const mongoURI = process.env.MONGO_URI;
    await mongoose.connect(mongoURI);
    console.log('MongoDB connected for domain management');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    throw error;
  }
}

// Initialize database connection
connectDB().catch(console.error);

/**
 * POST /api/add-domain
 * Add a new custom domain
 */
router.post('/add-domain', async (req, res) => {
  try {
    const { domain, siteSlug } = req.body;

    // Validate input
    if (!domain || !siteSlug) {
      return res.status(400).json({
        success: false,
        error: 'Domain and siteSlug are required'
      });
    }

    // Normalize domain (remove www prefix, lowercase)
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');

    console.log(`🌐 Adding domain: ${normalizedDomain} -> ${siteSlug}`);

    // Check if domain already exists
    const existingDomain = await Domain.findOne({ domain: normalizedDomain });
    if (existingDomain) {
      return res.status(409).json({
        success: false,
        error: 'Domain already exists',
        domain: existingDomain
      });
    }

    // Verify DNS first
    const dnsVerified = await domainService.verifyDNS(normalizedDomain);
    
    // Create domain record
    const domainRecord = new Domain({
      domain: normalizedDomain,
      siteSlug,
      dnsVerified,
      connected: dnsVerified,
      lastChecked: new Date()
    });

    await domainRecord.save();
    console.log(`Domain record created: ${normalizedDomain}`);

    // If DNS is verified, proceed with Nginx and SSL setup
    if (dnsVerified) {
      try {
        console.log(`🔧 Setting up Nginx for ${normalizedDomain}...`);
        
        // Create Nginx configuration
        const nginxSuccess = await domainService.createNginxConfig(normalizedDomain, siteSlug);
        
        if (nginxSuccess) {
          domainRecord.nginxConfigured = true;
          
          // Issue SSL certificate
          console.log(`🔒 Issuing SSL certificate for ${normalizedDomain}...`);
          const sslSuccess = await domainService.issueSSLCertificate(normalizedDomain);
          
          if (sslSuccess) {
            domainRecord.ssl = true;
            domainRecord.connected = true;
            
            // Get SSL expiry date
            const expiryDate = await domainService.getCertificateExpiry(normalizedDomain);
            if (expiryDate) {
              domainRecord.sslExpiry = expiryDate;
            }
          }
        }
        
        await domainRecord.save();
        console.log(`✅ Domain setup completed for ${normalizedDomain}`);
      } catch (error) {
        console.error(`❌ Domain setup failed for ${normalizedDomain}:`, error.message);
        domainRecord.errorMessage = error.message;
        await domainRecord.save();
      }
    }

    res.json({
      success: true,
      domain: domainRecord,
      message: dnsVerified ? 'Domain added and configured successfully' : 'Domain added, DNS verification pending'
    });

  } catch (error) {
    console.error('❌ Add domain error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/domains
 * Get all domains with their status
 */
router.get('/domains', async (req, res) => {
  try {
    const domains = await Domain.find({}).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      domains,
      count: domains.length
    });
  } catch (error) {
    console.error('Get domains error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/domains/:domain
 * Get specific domain details
 */
router.get('/domains/:domain', async (req, res) => {
  try {
    const { domain } = req.params;
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
    
    const domainRecord = await Domain.findOne({ domain: normalizedDomain });
    
    if (!domainRecord) {
      return res.status(404).json({
        success: false,
        error: 'Domain not found'
      });
    }

    // Get real-time status
    const status = await domainService.getDomainStatus(normalizedDomain);
    res.json({
      success: true,
      domain: domainRecord,
      status
    });
  } catch (error) {
    console.error('Get domain error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/domains/:domain/verify
 * Manually verify DNS for a domain
 */
router.post('/domains/:domain/verify', async (req, res) => {
  try {
    const { domain } = req.params;
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
    
    const domainRecord = await Domain.findOne({ domain: normalizedDomain });
    
    if (!domainRecord) {
      return res.status(404).json({
        success: false,
        error: 'Domain not found'
      });
    }

    console.log(`🔍 Manually verifying DNS for ${normalizedDomain}...`);
    
    // Verify DNS
    const dnsVerified = await domainService.verifyDNS(normalizedDomain);
    domainRecord.dnsVerified = dnsVerified;
    domainRecord.lastChecked = new Date();
    
    if (dnsVerified && !domainRecord.connected) {
      // DNS is now verified, proceed with setup
      try {
        console.log(`🔧 Setting up Nginx for ${normalizedDomain}...`);
        
        const nginxSuccess = await domainService.createNginxConfig(normalizedDomain, domainRecord.siteSlug);
        
        if (nginxSuccess) {
          domainRecord.nginxConfigured = true;
          
          // Issue SSL certificate
          const sslSuccess = await domainService.issueSSLCertificate(normalizedDomain);
          
          if (sslSuccess) {
            domainRecord.ssl = true;
            domainRecord.connected = true;
            
            const expiryDate = await domainService.getCertificateExpiry(normalizedDomain);
            if (expiryDate) {
              domainRecord.sslExpiry = expiryDate;
            }
          }
        }
        
        await domainRecord.save();
      } catch (error) {
        console.error(`Setup failed for ${normalizedDomain}:`, error.message);
        domainRecord.errorMessage = error.message;
        await domainRecord.save();
      }
    } else {
      await domainRecord.save();
    }

    res.json({
      success: true,
      domain: domainRecord,
      dnsVerified,
      message: dnsVerified ? 'DNS verified and domain configured' : 'DNS verification failed'
    });

  } catch (error) {
    console.error('Verify domain error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/domains/:domain
 * Remove a domain and its configuration
 */
router.delete('/domains/:domain', async (req, res) => {
  try {
    const { domain } = req.params;
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
    
    const domainRecord = await Domain.findOne({ domain: normalizedDomain });
    
    if (!domainRecord) {
      return res.status(404).json({
        success: false,
        error: 'Domain not found'
      });
    }

    console.log(`🗑️ Removing domain: ${normalizedDomain}...`);
    
    // Remove Nginx and SSL configuration
    await domainService.removeDomainConfig(normalizedDomain);
    
    // Remove from database
    await Domain.deleteOne({ domain: normalizedDomain });
    
    res.json({
      success: true,
      message: `Domain ${normalizedDomain} removed successfully`
    });

  } catch (error) {
    console.error('❌ Remove domain error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/domains/:domain/renew-ssl
 * Manually renew SSL certificate for a domain
 */
router.post('/domains/:domain/renew-ssl', async (req, res) => {
  try {
    const { domain } = req.params;
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
    
    const domainRecord = await Domain.findOne({ domain: normalizedDomain });
    
    if (!domainRecord) {
      return res.status(404).json({
        success: false,
        error: 'Domain not found'
      });
    }

    console.log(`🔄 Renewing SSL certificate for ${normalizedDomain}...`);
    
    const renewalResults = await domainService.renewSSLCertificates([normalizedDomain]);
    
    if (renewalResults.successful.includes(normalizedDomain)) {
      // Update expiry date
      const expiryDate = await domainService.getCertificateExpiry(normalizedDomain);
      if (expiryDate) {
        domainRecord.sslExpiry = expiryDate;
        await domainRecord.save();
      }
      
      res.json({
        success: true,
        message: 'SSL certificate renewed successfully',
        expiryDate
      });
    } else {
      res.json({
        success: false,
        message: 'SSL certificate renewal failed or not needed',
        results: renewalResults
      });
    }

  } catch (error) {
    console.error('Renew SSL error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/domains/pending/check
 * Check all pending domains (for cron job or manual trigger)
 */
router.get('/domains/pending/check', async (req, res) => {
  try {
    console.log('🔍 Checking all pending domains...');
    
    const pendingDomains = await Domain.findPendingDomains();
    const results = {
      checked: 0,
      connected: 0,
      failed: 0,
      details: []
    };
    
    for (const domainRecord of pendingDomains) {
      try {
        results.checked++;
        
        console.log(`🔍 Checking ${domainRecord.domain}...`);
        
        const dnsVerified = await domainService.verifyDNS(domainRecord.domain);
        domainRecord.lastChecked = new Date();
        
        if (dnsVerified && !domainRecord.connected) {
          // DNS is now verified, proceed with setup
          try {
            console.log(`🔧 Setting up ${domainRecord.domain}...`);
            
            const nginxSuccess = await domainService.createNginxConfig(
              domainRecord.domain, 
              domainRecord.siteSlug
            );
            
            if (nginxSuccess) {
              domainRecord.nginxConfigured = true;
              
              const sslSuccess = await domainService.issueSSLCertificate(domainRecord.domain);
              
              if (sslSuccess) {
                domainRecord.ssl = true;
                domainRecord.connected = true;
                
                const expiryDate = await domainService.getCertificateExpiry(domainRecord.domain);
                if (expiryDate) {
                  domainRecord.sslExpiry = expiryDate;
                }
                
                results.connected++;
                results.details.push({
                  domain: domainRecord.domain,
                  status: 'connected',
                  message: 'Domain connected successfully'
                });
              }
            }
          } catch (error) {
            console.error(`❌ Setup failed for ${domainRecord.domain}:`, error.message);
            domainRecord.errorMessage = error.message;
            results.failed++;
            results.details.push({
              domain: domainRecord.domain,
              status: 'failed',
              error: error.message
            });
          }
        } else if (!dnsVerified) {
          results.details.push({
            domain: domainRecord.domain,
            status: 'pending',
            message: 'DNS not yet verified'
          });
        }
        
        await domainRecord.save();
        
      } catch (error) {
        console.error(`❌ Check failed for ${domainRecord.domain}:`, error.message);
        results.failed++;
        results.details.push({
          domain: domainRecord.domain,
          status: 'error',
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      results,
      message: `Checked ${results.checked} domains: ${results.connected} connected, ${results.failed} failed`
    });

  } catch (error) {
    console.error('❌ Check pending domains error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/domains/status/summary
 * Get summary of all domain statuses
 */
router.get('/domains/status/summary', async (req, res) => {
  try {
    const totalDomains = await Domain.countDocuments();
    const connectedDomains = await Domain.countDocuments({ connected: true });
    const pendingDomains = await Domain.countDocuments({ connected: false });
    const sslDomains = await Domain.countDocuments({ ssl: true });
    
    const expiringSSL = await Domain.findExpiringSSL(30);
    
    res.json({
      success: true,
      summary: {
        total: totalDomains,
        connected: connectedDomains,
        pending: pendingDomains,
        ssl: sslDomains,
        expiringSSL: expiringSSL.length,
        sslExpiringSoon: expiringSSL.map(d => ({
          domain: d.domain,
          expiry: d.sslExpiry
        }))
      }
    });
  } catch (error) {
    console.error('❌ Get status summary error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
