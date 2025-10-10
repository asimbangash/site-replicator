# Website Duplicator & Editor with Custom Domain Hosting

Clone any website, edit its content and colors with a visual editor, and host it on your own custom domain with automatic SSL.

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:3000/editor

## Features

- **Clone Websites**: Clone any website with assets
- **Visual Editor**: Edit text content and colors
- **Live Preview**: See changes instantly
- **Batch Save**: Save multiple changes at once
- **🌐 Custom Domain Hosting**: Connect your own domains with automatic SSL
- **🔒 Automatic SSL**: Let's Encrypt certificates with auto-renewal
- **📊 Domain Management**: Web interface for domain management
- **🤖 AI-Powered Ads**: Generate ads from documents and images

## API Endpoints

### Clone Website
```bash
POST /clone-website
Content-Type: application/json

{
  "url": "https://example.com",
  "name": "My Site"
}
```

### List Cloned Sites
```bash
GET /cloned-sites
```

### Preview Site
```bash
GET /preview/:siteId
```

### Edit Site
```bash
GET /editor
```

### Domain Management
```bash
# Add custom domain
POST /api/add-domain
Content-Type: application/json

{
  "domain": "example.com",
  "siteSlug": "site-1"
}

# List all domains
GET /api/domains

# Domain management interface
GET /domains
```

### AI Ad Generation
```bash
# Create ads from documents
POST /api/create-ads
Content-Type: multipart/form-data

# Sync approved ads to Google Drive
POST /api/sync-to-drive
```

## Editor Usage

1. Select a site from sidebar
2. Edit text content inline
3. Change colors with color picker
4. Click "Save All Changes"

## Custom Domain Hosting

### Quick Setup

1. **Add DNS Record**: Point your domain to `172.245.168.61`
2. **Open Domain Manager**: Go to `/domains`
3. **Add Domain**: Enter your domain and select a site
4. **Automatic Setup**: System handles DNS verification, Nginx config, and SSL

### Requirements

- Ubuntu/Debian server with root access
- MongoDB installed
- Nginx installed
- Certbot installed
- Domain with DNS control

See [DOMAIN_MANAGEMENT.md](./DOMAIN_MANAGEMENT.md) for detailed setup instructions.

## File Structure

```
├── server.js              # Main server
├── routes/
│   ├── editor.js          # Editor API routes
│   └── domains.js         # Domain management routes
├── models/
│   └── Domain.js          # MongoDB domain schema
├── services/
│   ├── domain-service.js  # DNS, Nginx, SSL management
│   └── cron-service.js    # Automated domain checks
├── public/
│   ├── editor.html        # Editor dashboard
│   ├── domains.html       # Domain management interface
│   ├── create-ads.html    # AI ad generation
│   └── approve-ads.html   # Ad approval interface
├── cloned_sites/          # Stored websites
│   └── [siteId]/
│       ├── index.html     # Main HTML file
│       ├── assets/        # CSS, JS, images
│       └── metadata.json  # Site info
├── uploads/               # Uploaded files
└── package.json
```

## Dependencies

- Express.js - Web server
- Playwright - Website cloning
- Cheerio - HTML parsing
- Axios - HTTP requests
- Mongoose - MongoDB ODM
- Node-cron - Scheduled tasks
- Multer - File uploads
- AI Services - OpenAI, Google AI, Groq, etc.

## License

MIT
