const express = require('express');
const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const app = express();
app.use(express.json());

class WebsiteCloner {
    constructor() {
        this.outputDir = './cloned_sites';
    }

    async ensureDirectoryExists(dirPath) {
        try {
            await fs.access(dirPath);
        } catch (error) {
            await fs.mkdir(dirPath, { recursive: true });
        }
    }

    async downloadAsset(assetUrl, baseUrl, outputDir) {
        try {
            const absoluteUrl = new URL(assetUrl, baseUrl).href;
            const response = await axios.get(absoluteUrl, { 
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                maxRedirects: 5,
                validateStatus: function (status) {
                    return status < 500; // Accept any status code less than 500
                }
            });
            
            const parsedUrl = url.parse(assetUrl);
            let fileName = path.basename(parsedUrl.pathname) || 'asset';
            
            // Ensure we have an extension
            if (!path.extname(fileName)) {
                const contentType = response.headers['content-type'];
                if (contentType.includes('css')) fileName += '.css';
                else if (contentType.includes('javascript')) fileName += '.js';
                else if (contentType.includes('image/png')) fileName += '.png';
                else if (contentType.includes('image/jpeg')) fileName += '.jpg';
                else if (contentType.includes('image/gif')) fileName += '.gif';
            }
            
            // Handle long filenames by creating a hash-based name
            if (fileName.length > 200) {
                const hash = crypto.createHash('md5').update(assetUrl).digest('hex');
                const ext = path.extname(fileName) || '.asset';
                fileName = `asset_${hash}${ext}`;
            }

            const filePath = path.join(outputDir, 'assets', fileName);
            await this.ensureDirectoryExists(path.dirname(filePath));
            await fs.writeFile(filePath, response.data);
            
            return `./assets/${fileName}`;
        } catch (error) {
            console.warn(`Failed to download asset ${assetUrl}:`, error.message);
            return assetUrl; // Return original URL if download fails
        }
    }

    async cloneWebsite(targetUrl) {
        console.log(`Starting to clone ${targetUrl}`);
        
        // Add global timeout wrapper
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Operation timed out after 2 minutes')), 120000);
        });
        
        try {
            // First try with Playwright for full JS rendering
            const playwrightPromise = this.cloneWithPlaywright(targetUrl);
            return await Promise.race([playwrightPromise, timeoutPromise]);
        } catch (playwrightError) {
            console.log('Playwright failed, falling back to axios method:', playwrightError.message);
            try {
                const axiosPromise = this.cloneWithAxios(targetUrl);
                return await Promise.race([axiosPromise, timeoutPromise]);
            } catch (axiosError) {
                throw axiosError;
            }
        }
    }

    async cloneWithPlaywright(targetUrl) {
        console.log(`Launching browser for ${targetUrl}`);
        let browser;
        
        try {
            browser = await chromium.launch({
                headless: true,
                timeout: 30000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor'
                ]
            });
            console.log('Browser launched successfully');
        } catch (launchError) {
            console.error('Failed to launch browser:', launchError);
            throw new Error(`Browser launch failed: ${launchError.message}`);
        }
        
        try {
            console.log('Creating new page...');
            const context = await browser.newContext({
                viewport: { width: 1920, height: 1080 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                }
            });
            
            // Set timeout for all page operations
            context.setDefaultTimeout(60000);
            const page = await context.newPage();
            
            console.log(`Navigating to ${targetUrl}...`);
            
            // Try multiple navigation strategies
            try {
                await page.goto(targetUrl, { 
                    waitUntil: 'networkidle',
                    timeout: 60000 
                });
            } catch (navError) {
                console.log('First navigation attempt failed, trying with domcontentloaded...');
                await page.goto(targetUrl, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });
            }
            
            console.log('Page loaded successfully');

            // Wait a bit more for React/Next.js to fully render
            await page.waitForTimeout(3000);

            // Get the full HTML after JavaScript execution
            const html = await page.content();
            
            // Parse with Cheerio for manipulation
            const $ = cheerio.load(html);
            
            // Create output directory
            const siteId = Date.now().toString();
            const siteDir = path.join(this.outputDir, siteId);
            await this.ensureDirectoryExists(siteDir);
            await this.ensureDirectoryExists(path.join(siteDir, 'assets'));

            // Download and replace CSS files
            const cssLinks = $('link[rel="stylesheet"]');
            for (let i = 0; i < cssLinks.length; i++) {
                const link = cssLinks.eq(i);
                const href = link.attr('href');
                if (href) {
                    const localPath = await this.downloadAsset(href, targetUrl, siteDir);
                    link.attr('href', localPath);
                }
            }

            // Download and replace JavaScript files
            const scriptTags = $('script[src]');
            for (let i = 0; i < scriptTags.length; i++) {
                const script = scriptTags.eq(i);
                const src = script.attr('src');
                if (src && !src.startsWith('http')) {
                    const localPath = await this.downloadAsset(src, targetUrl, siteDir);
                    script.attr('src', localPath);
                }
            }

            // Download and replace images
            const images = $('img[src]');
            for (let i = 0; i < images.length; i++) {
                const img = images.eq(i);
                const src = img.attr('src');
                if (src) {
                    const localPath = await this.downloadAsset(src, targetUrl, siteDir);
                    img.attr('src', localPath);
                }
            }

            // Extract and save inline styles
            const inlineStyles = [];
            $('style').each((i, elem) => {
                inlineStyles.push($(elem).html());
            });

            // Save the modified HTML
            const finalHtml = $.html();
            await fs.writeFile(path.join(siteDir, 'index.html'), finalHtml);

            // Save extracted styles to a separate file for easier editing
            if (inlineStyles.length > 0) {
                const combinedStyles = inlineStyles.join('\n\n');
                await fs.writeFile(path.join(siteDir, 'extracted-styles.css'), combinedStyles);
            }

            // Save metadata
            const metadata = {
                originalUrl: targetUrl,
                clonedAt: new Date().toISOString(),
                siteId: siteId,
                method: 'playwright',
                assets: await this.getAssetsList(path.join(siteDir, 'assets'))
            };
            await fs.writeFile(path.join(siteDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

            return {
                success: true,
                siteId: siteId,
                path: siteDir,
                metadata: metadata,
                method: 'playwright'
            };

        } catch (error) {
            console.error('Cloning error:', error);
            console.error('Error stack:', error.stack);
            return {
                success: false,
                error: error.message,
                details: error.code || 'Unknown error code',
                method: 'playwright'
            };
        } finally {
            if (browser) {
                try {
                    await browser.close();
                    console.log('Browser closed successfully');
                } catch (closeError) {
                    console.error('Error closing browser:', closeError);
                }
            }
        }
    }

    async cloneWithAxios(targetUrl) {
        console.log(`Using axios fallback method for ${targetUrl}`);
        
        try {
            // Fetch the HTML with axios
            const response = await axios.get(targetUrl, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                },
                maxRedirects: 5,
                validateStatus: function (status) {
                    return status < 500;
                }
            });

            const html = response.data;
            console.log('HTML fetched successfully with axios');

            // Parse with Cheerio for manipulation
            const $ = cheerio.load(html);
            
            // Create output directory
            const siteId = Date.now().toString();
            const siteDir = path.join(this.outputDir, siteId);
            await this.ensureDirectoryExists(siteDir);
            await this.ensureDirectoryExists(path.join(siteDir, 'assets'));

            // Download and replace CSS files
            const cssLinks = $('link[rel="stylesheet"]');
            for (let i = 0; i < cssLinks.length; i++) {
                const link = cssLinks.eq(i);
                const href = link.attr('href');
                if (href) {
                    const localPath = await this.downloadAsset(href, targetUrl, siteDir);
                    link.attr('href', localPath);
                }
            }

            // Download and replace JavaScript files
            const scriptTags = $('script[src]');
            for (let i = 0; i < scriptTags.length; i++) {
                const script = scriptTags.eq(i);
                const src = script.attr('src');
                if (src && !src.startsWith('http')) {
                    const localPath = await this.downloadAsset(src, targetUrl, siteDir);
                    script.attr('src', localPath);
                }
            }

            // Download and replace images
            const images = $('img[src]');
            for (let i = 0; i < images.length; i++) {
                const img = images.eq(i);
                const src = img.attr('src');
                if (src) {
                    const localPath = await this.downloadAsset(src, targetUrl, siteDir);
                    img.attr('src', localPath);
                }
            }

            // Extract and save inline styles
            const inlineStyles = [];
            $('style').each((i, elem) => {
                inlineStyles.push($(elem).html());
            });

            // Save the modified HTML
            const finalHtml = $.html();
            await fs.writeFile(path.join(siteDir, 'index.html'), finalHtml);

            // Save extracted styles to a separate file for easier editing
            if (inlineStyles.length > 0) {
                const combinedStyles = inlineStyles.join('\n\n');
                await fs.writeFile(path.join(siteDir, 'extracted-styles.css'), combinedStyles);
            }

            // Save metadata
            const metadata = {
                originalUrl: targetUrl,
                clonedAt: new Date().toISOString(),
                siteId: siteId,
                method: 'axios-fallback',
                assets: await this.getAssetsList(path.join(siteDir, 'assets'))
            };
            await fs.writeFile(path.join(siteDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

            return {
                success: true,
                siteId: siteId,
                path: siteDir,
                metadata: metadata,
                method: 'axios-fallback'
            };

        } catch (error) {
            console.error('Axios cloning error:', error);
            return {
                success: false,
                error: error.message,
                method: 'axios-fallback'
            };
        }
    }

    async getAssetsList(assetsDir) {
        try {
            const files = await fs.readdir(assetsDir);
            return files;
        } catch (error) {
            return [];
        }
    }
}

// API Endpoints
const cloner = new WebsiteCloner();

app.post('/clone-website', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`Starting to clone website: ${url}`);
    
    try {
        const result = await cloner.cloneWebsite(url);
        console.log(`Clone result:`, result);
        res.json(result);
    } catch (error) {
        console.error('API endpoint error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: error.stack
        });
    }
});

app.get('/cloned-sites', async (req, res) => {
    try {
        const sites = await fs.readdir(cloner.outputDir);
        const sitesList = [];
        
        for (const siteId of sites) {
            try {
                const metadataPath = path.join(cloner.outputDir, siteId, 'metadata.json');
                const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
                sitesList.push(metadata);
            } catch (error) {
                console.warn(`Could not read metadata for site ${siteId}`);
            }
        }
        
        res.json(sitesList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/preview/:siteId', async (req, res) => {
    const { siteId } = req.params;
    const htmlPath = path.join(cloner.outputDir, siteId, 'index.html');
    
    try {
        let html = await fs.readFile(htmlPath, 'utf8');
        
        // Fix asset paths to work with our server setup
        html = html.replace(/src="\.\/assets\//g, `src="/cloned-sites/${siteId}/assets/`);
        html = html.replace(/href="\.\/assets\//g, `href="/cloned-sites/${siteId}/assets/`);
        html = html.replace(/url\(\.\/assets\//g, `url(/cloned-sites/${siteId}/assets/`);
        
        // Fix custom CSS path
        html = html.replace(/href="\.\/custom-colors\.css"/g, `href="/cloned-sites/${siteId}/custom-colors.css"`);
        
        // Add base tag to fix relative paths
        html = html.replace('<head>', `<head><base href="/cloned-sites/${siteId}/">`);
        
        // Fix iframe embedding issues
        html = html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="frame-ancestors \'self\';">');
        
        res.send(html);
    } catch (error) {
        res.status(404).json({ error: 'Site not found' });
    }
});

// Serve static files
app.use('/public', express.static(path.join(__dirname, 'public')));

// Serve assets for each cloned site
app.use('/cloned-sites/:siteId/assets', (req, res, next) => {
    const { siteId } = req.params;
    const assetsPath = path.join(__dirname, 'cloned_sites', siteId, 'assets');
    express.static(assetsPath)(req, res, next);
});

// Serve entire cloned site directories for any other files
app.use('/cloned-sites/:siteId', (req, res, next) => {
    const { siteId } = req.params;
    const sitePath = path.join(__dirname, 'cloned_sites', siteId);
    express.static(sitePath)(req, res, next);
});

// Use editor routes
const editorRoutes = require('./routes/editor');
app.use('/', editorRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Website Cloner API running on port ${PORT}`);
    console.log(`\nUsage:`);
    console.log(`POST /clone-website - Clone a website`);
    console.log(`GET /cloned-sites - List all cloned sites`);
    console.log(`GET /preview/:siteId - Preview a cloned site`);
    console.log(`GET /editor - Open the Editor Dashboard`);
    console.log(`API endpoints for editing available at /api/sites/*`);
});

module.exports = { WebsiteCloner, app };