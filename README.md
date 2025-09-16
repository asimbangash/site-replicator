# Website Duplicator & Editor

Clone any website and edit its content and colors with a visual editor.

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

## API Endpoints

### Clone Website
```bash
POST /clone-website
Content-Type: application/json

{
  "url": "https://example.com"
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

## Editor Usage

1. Select a site from sidebar
2. Edit text content inline
3. Change colors with color picker
4. Click "Save All Changes"

## File Structure

```
├── server.js              # Main server
├── routes/editor.js        # Editor API routes
├── public/editor.html      # Editor dashboard
├── cloned_sites/          # Stored websites
│   └── [siteId]/
│       ├── index.html     # Main HTML file
│       ├── assets/        # CSS, JS, images
│       └── metadata.json  # Site info
└── package.json
```

## Dependencies

- Express.js - Web server
- Playwright - Website cloning
- Cheerio - HTML parsing
- Axios - HTTP requests

## License

MIT
