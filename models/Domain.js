const mongoose = require('mongoose');

const domainSchema = new mongoose.Schema({
  domain: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: function(v) {
        // Basic domain validation regex
        return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/.test(v);
      },
      message: 'Invalid domain format'
    }
  },
  siteSlug: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        // Site slug should be alphanumeric with underscores/hyphens
        return /^[a-zA-Z0-9_-]+$/.test(v);
      },
      message: 'Site slug must contain only alphanumeric characters, underscores, and hyphens'
    }
  },
  connected: {
    type: Boolean,
    default: false,
    index: true
  },
  ssl: {
    type: Boolean,
    default: false,
    index: true
  },
  dnsVerified: {
    type: Boolean,
    default: false,
    index: true
  },
  nginxConfigured: {
    type: Boolean,
    default: false
  },
  sslExpiry: {
    type: Date,
    default: null
  },
  lastChecked: {
    type: Date,
    default: Date.now,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  // Additional metadata
  metadata: {
    serverIP: {
      type: String,
      default: process.env.SERVER_IP
    },
    nginxConfigPath: {
      type: String,
      default: null
    },
    certbotDomain: {
      type: String,
      default: null
    },
    errorMessage: {
      type: String,
      default: null
    },
    retryCount: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true, // Automatically manage createdAt and updatedAt
  collection: 'domains'
});

// Indexes for better query performance
domainSchema.index({ domain: 1 });
domainSchema.index({ siteSlug: 1 });
domainSchema.index({ connected: 1, dnsVerified: 1 });
domainSchema.index({ lastChecked: 1 });

// Pre-save middleware to update timestamps
domainSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance methods
domainSchema.methods.markAsConnected = function() {
  this.connected = true;
  this.dnsVerified = true;
  this.nginxConfigured = true;
  this.errorMessage = null;
  return this.save();
};

domainSchema.methods.markAsDisconnected = function(errorMessage = null) {
  this.connected = false;
  this.dnsVerified = false;
  this.nginxConfigured = false;
  this.ssl = false;
  this.errorMessage = errorMessage;
  this.retryCount += 1;
  return this.save();
};

domainSchema.methods.updateLastChecked = function() {
  this.lastChecked = new Date();
  return this.save();
};

// Static methods
domainSchema.statics.findPendingDomains = function() {
  return this.find({
    connected: false,
    retryCount: { $lt: 10 } // Don't retry more than 10 times
  }).sort({ lastChecked: 1 });
};

domainSchema.statics.findConnectedDomains = function() {
  return this.find({ connected: true });
};

domainSchema.statics.findExpiringSSL = function(daysBeforeExpiry = 30) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + daysBeforeExpiry);
  
  return this.find({
    ssl: true,
    sslExpiry: { $lte: expiryDate }
  });
};

// Virtual for domain status
domainSchema.virtual('status').get(function() {
  if (this.connected && this.ssl) return 'active';
  if (this.connected && !this.ssl) return 'connected-no-ssl';
  if (this.dnsVerified && !this.connected) return 'dns-verified';
  if (this.retryCount >= 10) return 'failed';
  return 'pending';
});

// Ensure virtual fields are serialized
domainSchema.set('toJSON', { virtuals: true });
domainSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Domain', domainSchema);
