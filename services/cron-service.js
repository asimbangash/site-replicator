const cron = require('node-cron');
const Domain = require('../models/Domain');
const DomainService = require('./domain-service');

/**
 * Cron Service - Handles scheduled tasks for domain management
 */
class CronService {
  constructor() {
    this.domainService = new DomainService();
    this.tasks = new Map();
    this.isRunning = false;
  }

  /**
   * Start all cron jobs
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Cron service is already running');
      return;
    }

    console.log('🚀 Starting cron service...');

    // Task 1: Check pending domains every 30 minutes
    const pendingCheckTask = cron.schedule('*/30 * * * *', async () => {
      await this.checkPendingDomains();
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    // Task 2: Check SSL expiry every day at 2 AM
    const sslCheckTask = cron.schedule('0 2 * * *', async () => {
      await this.checkSSLCertificates();
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    // Task 3: Renew SSL certificates every Sunday at 3 AM
    const sslRenewalTask = cron.schedule('0 3 * * 0', async () => {
      await this.renewSSLCertificates();
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    // Task 4: Cleanup old failed domains every week
    const cleanupTask = cron.schedule('0 4 * * 1', async () => {
      await this.cleanupOldDomains();
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    // Store tasks
    this.tasks.set('pendingCheck', pendingCheckTask);
    this.tasks.set('sslCheck', sslCheckTask);
    this.tasks.set('sslRenewal', sslRenewalTask);
    this.tasks.set('cleanup', cleanupTask);

    // Start all tasks
    this.tasks.forEach((task, name) => {
      task.start();
      console.log(`✅ Started cron task: ${name}`);
    });

    this.isRunning = true;
    console.log('🎯 Cron service started successfully');

    // Run initial checks
    setTimeout(() => {
      this.checkPendingDomains();
      this.checkSSLCertificates();
    }, 5000); // Wait 5 seconds after startup
  }

  /**
   * Stop all cron jobs
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Cron service is not running');
      return;
    }

    console.log('🛑 Stopping cron service...');

    this.tasks.forEach((task, name) => {
      task.stop();
      console.log(`⏹️ Stopped cron task: ${name}`);
    });

    this.tasks.clear();
    this.isRunning = false;
    console.log('✅ Cron service stopped');
  }

  /**
   * Check all pending domains and attempt to connect them
   */
  async checkPendingDomains() {
    try {
      console.log('🔍 [CRON] Checking pending domains...');
      
      const pendingDomains = await Domain.findPendingDomains();
      
      if (pendingDomains.length === 0) {
        console.log('📋 [CRON] No pending domains to check');
        return;
      }

      console.log(`📋 [CRON] Found ${pendingDomains.length} pending domains`);

      const results = {
        checked: 0,
        connected: 0,
        failed: 0,
        errors: []
      };

      for (const domainRecord of pendingDomains) {
        try {
          results.checked++;
          
          console.log(`🔍 [CRON] Checking ${domainRecord.domain}...`);
          
          // Verify DNS
          const dnsVerified = await this.domainService.verifyDNS(domainRecord.domain);
          domainRecord.lastChecked = new Date();
          
          if (dnsVerified && !domainRecord.connected) {
            // DNS is now verified, proceed with setup
            try {
              console.log(`🔧 [CRON] Setting up ${domainRecord.domain}...`);
              
              // Create Nginx configuration
              const nginxSuccess = await this.domainService.createNginxConfig(
                domainRecord.domain, 
                domainRecord.siteSlug
              );
              
              if (nginxSuccess) {
                domainRecord.nginxConfigured = true;
                
                // Issue SSL certificate
                const sslSuccess = await this.domainService.issueSSLCertificate(domainRecord.domain);
                
                if (sslSuccess) {
                  domainRecord.ssl = true;
                  domainRecord.connected = true;
                  
                  // Get SSL expiry date
                  const expiryDate = await this.domainService.getCertificateExpiry(domainRecord.domain);
                  if (expiryDate) {
                    domainRecord.sslExpiry = expiryDate;
                  }
                  
                  results.connected++;
                  console.log(`✅ [CRON] Domain ${domainRecord.domain} connected successfully`);
                } else {
                  console.log(`⚠️ [CRON] SSL setup failed for ${domainRecord.domain}`);
                }
              } else {
                console.log(`⚠️ [CRON] Nginx setup failed for ${domainRecord.domain}`);
              }
            } catch (error) {
              console.error(`❌ [CRON] Setup failed for ${domainRecord.domain}:`, error.message);
              domainRecord.errorMessage = error.message;
              results.failed++;
              results.errors.push({
                domain: domainRecord.domain,
                error: error.message
              });
            }
          } else if (!dnsVerified) {
            console.log(`⏳ [CRON] DNS not yet verified for ${domainRecord.domain}`);
          }
          
          await domainRecord.save();
          
        } catch (error) {
          console.error(`❌ [CRON] Check failed for ${domainRecord.domain}:`, error.message);
          results.failed++;
          results.errors.push({
            domain: domainRecord.domain,
            error: error.message
          });
        }
      }
      
      console.log(`📊 [CRON] Pending domains check completed: ${results.checked} checked, ${results.connected} connected, ${results.failed} failed`);
      
      if (results.errors.length > 0) {
        console.log('❌ [CRON] Errors encountered:', results.errors);
      }

    } catch (error) {
      console.error('❌ [CRON] Pending domains check failed:', error.message);
    }
  }

  /**
   * Check SSL certificates for expiry
   */
  async checkSSLCertificates() {
    try {
      console.log('🔒 [CRON] Checking SSL certificates...');
      
      const expiringDomains = await Domain.findExpiringSSL(30); // 30 days before expiry
      
      if (expiringDomains.length === 0) {
        console.log('📋 [CRON] No SSL certificates expiring soon');
        return;
      }

      console.log(`📋 [CRON] Found ${expiringDomains.length} SSL certificates expiring soon`);

      for (const domainRecord of expiringDomains) {
        console.log(`⚠️ [CRON] SSL certificate for ${domainRecord.domain} expires on ${domainRecord.sslExpiry}`);
        
        // Update expiry date from actual certificate
        try {
          const actualExpiry = await this.domainService.getCertificateExpiry(domainRecord.domain);
          if (actualExpiry) {
            domainRecord.sslExpiry = actualExpiry;
            await domainRecord.save();
          }
        } catch (error) {
          console.error(`❌ [CRON] Could not update expiry for ${domainRecord.domain}:`, error.message);
        }
      }

    } catch (error) {
      console.error('❌ [CRON] SSL certificate check failed:', error.message);
    }
  }

  /**
   * Renew SSL certificates
   */
  async renewSSLCertificates() {
    try {
      console.log('🔄 [CRON] Renewing SSL certificates...');
      
      const sslDomains = await Domain.find({ ssl: true });
      
      if (sslDomains.length === 0) {
        console.log('📋 [CRON] No SSL certificates to renew');
        return;
      }

      console.log(`📋 [CRON] Found ${sslDomains.length} SSL certificates to check for renewal`);

      const domainsToRenew = sslDomains.map(d => d.domain);
      const renewalResults = await this.domainService.renewSSLCertificates(domainsToRenew);
      
      console.log(`📊 [CRON] SSL renewal results:`, renewalResults);
      
      // Update expiry dates for successfully renewed certificates
      for (const domain of renewalResults.successful) {
        try {
          const domainRecord = await Domain.findOne({ domain });
          if (domainRecord) {
            const expiryDate = await this.domainService.getCertificateExpiry(domain);
            if (expiryDate) {
              domainRecord.sslExpiry = expiryDate;
              await domainRecord.save();
              console.log(`✅ [CRON] Updated expiry date for ${domain}: ${expiryDate}`);
            }
          }
        } catch (error) {
          console.error(`❌ [CRON] Could not update expiry for ${domain}:`, error.message);
        }
      }

    } catch (error) {
      console.error('❌ [CRON] SSL certificate renewal failed:', error.message);
    }
  }

  /**
   * Cleanup old failed domains
   */
  async cleanupOldDomains() {
    try {
      console.log('🧹 [CRON] Cleaning up old failed domains...');
      
      // Find domains that have failed more than 10 times and are older than 7 days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);
      
      const oldFailedDomains = await Domain.find({
        connected: false,
        retryCount: { $gte: 10 },
        createdAt: { $lt: cutoffDate }
      });
      
      if (oldFailedDomains.length === 0) {
        console.log('📋 [CRON] No old failed domains to cleanup');
        return;
      }

      console.log(`📋 [CRON] Found ${oldFailedDomains.length} old failed domains to cleanup`);

      for (const domainRecord of oldFailedDomains) {
        try {
          console.log(`🗑️ [CRON] Removing old failed domain: ${domainRecord.domain}`);
          
          // Remove Nginx and SSL configuration
          await this.domainService.removeDomainConfig(domainRecord.domain);
          
          // Remove from database
          await Domain.deleteOne({ _id: domainRecord._id });
          
          console.log(`✅ [CRON] Removed old failed domain: ${domainRecord.domain}`);
        } catch (error) {
          console.error(`❌ [CRON] Could not remove domain ${domainRecord.domain}:`, error.message);
        }
      }

    } catch (error) {
      console.error('❌ [CRON] Domain cleanup failed:', error.message);
    }
  }

  /**
   * Get cron service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      tasks: Array.from(this.tasks.keys()),
      taskCount: this.tasks.size
    };
  }

  /**
   * Manually trigger a specific task
   */
  async triggerTask(taskName) {
    if (!this.isRunning) {
      throw new Error('Cron service is not running');
    }

    switch (taskName) {
      case 'pendingCheck':
        await this.checkPendingDomains();
        break;
      case 'sslCheck':
        await this.checkSSLCertificates();
        break;
      case 'sslRenewal':
        await this.renewSSLCertificates();
        break;
      case 'cleanup':
        await this.cleanupOldDomains();
        break;
      default:
        throw new Error(`Unknown task: ${taskName}`);
    }
  }
}

module.exports = CronService;
