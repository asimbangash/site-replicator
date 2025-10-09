require("dotenv").config();

const express = require("express");
const { chromium } = require("playwright");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs").promises;
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const multer = require("multer");

// Import AI services
const { initializeAI, generateCreatives } = require("./services/ai-service");
const { processDocumentForAI } = require("./services/document-processor");
const { GoogleDriveService } = require("./services/google-drive-service");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./uploads/");
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const extension = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, extension);
    cb(null, `${baseName}_${timestamp}${extension}`);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      ".pdf",
      ".docx",
      ".doc",
      ".txt",
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
    ];
    const extension = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(extension)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `File type ${extension} not allowed. Allowed types: ${allowedTypes.join(
            ", "
          )}`
        )
      );
    }
  },
});

// Initialize Google Drive service
const driveService = new GoogleDriveService();

// Ensure uploads directory exists
async function ensureUploadsDirectory() {
  try {
    await fs.access("./uploads");
  } catch (error) {
    await fs.mkdir("./uploads", { recursive: true });
    console.log("📁 Created uploads directory");
  }
}

// Initialize services
async function initializeServices() {
  await ensureUploadsDirectory();
  await initializeAI();

  // Initialize Google Drive service
  try {
    await driveService.initialize();
  } catch (error) {
    console.warn(
      "⚠️ Google Drive service initialization failed:",
      error.message
    );
  }
}

class WebsiteCloner {
  constructor() {
    this.outputDir = "./cloned_sites";
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
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
        maxRedirects: 5,
        validateStatus: function (status) {
          return status < 500; // Accept any status code less than 500
        },
      });

      const parsedUrl = url.parse(assetUrl);
      let fileName = path.basename(parsedUrl.pathname) || "asset";

      // Ensure we have an extension
      if (!path.extname(fileName)) {
        const contentType = response.headers["content-type"];
        if (contentType.includes("css")) fileName += ".css";
        else if (contentType.includes("javascript")) fileName += ".js";
        else if (contentType.includes("image/png")) fileName += ".png";
        else if (contentType.includes("image/jpeg")) fileName += ".jpg";
        else if (contentType.includes("image/gif")) fileName += ".gif";
      }

      // Handle long filenames by creating a hash-based name
      if (fileName.length > 200) {
        const hash = crypto.createHash("md5").update(assetUrl).digest("hex");
        const ext = path.extname(fileName) || ".asset";
        fileName = `asset_${hash}${ext}`;
      }

      const filePath = path.join(outputDir, "assets", fileName);
      await this.ensureDirectoryExists(path.dirname(filePath));
      await fs.writeFile(filePath, response.data);

      return `./assets/${fileName}`;
    } catch (error) {
      console.warn(`Failed to download asset ${assetUrl}:`, error.message);
      return assetUrl; // Return original URL if download fails
    }
  }

  async cloneWebsite(targetUrl, siteName = "") {
    console.log(`Starting to clone ${targetUrl} with name ${siteName}`);

    // Add global timeout wrapper
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("Operation timed out after 2 minutes")),
        120000
      );
    });

    try {
      // First try with Playwright for full JS rendering
      const playwrightPromise = this.cloneWithPlaywright(targetUrl, siteName);
      return await Promise.race([playwrightPromise, timeoutPromise]);
    } catch (playwrightError) {
      console.log(
        "Playwright failed, falling back to axios method:",
        playwrightError.message
      );
      try {
        const axiosPromise = this.cloneWithAxios(targetUrl, siteName);
        return await Promise.race([axiosPromise, timeoutPromise]);
      } catch (axiosError) {
        throw axiosError;
      }
    }
  }

  async cloneWithPlaywright(targetUrl, siteName = "") {
    console.log(`Launching browser for ${targetUrl} with name ${siteName}`);
    let browser;

    try {
      browser = await chromium.launch({
        headless: true,
        timeout: 30000,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-web-security",
          "--disable-features=VizDisplayCompositor",
        ],
      });
      console.log("Browser launched successfully");
    } catch (launchError) {
      console.error("Failed to launch browser:", launchError);
      throw new Error(`Browser launch failed: ${launchError.message}`);
    }

    try {
      console.log("Creating new page...");
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
      });

      // Set timeout for all page operations
      context.setDefaultTimeout(60000);
      const page = await context.newPage();

      console.log(`Navigating to ${targetUrl}...`);

      // Try multiple navigation strategies
      try {
        await page.goto(targetUrl, {
          waitUntil: "networkidle",
          timeout: 60000,
        });
      } catch (navError) {
        console.log(
          "First navigation attempt failed, trying with domcontentloaded..."
        );
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      }

      console.log("Page loaded successfully");

      // Wait a bit more for React/Next.js to fully render
      await page.waitForTimeout(3000);

      // Get the full HTML after JavaScript execution
      const html = await page.content();

      // Parse with Cheerio for manipulation
      const $ = cheerio.load(html);

      // Create output directory with site name only
      let siteId;
      if (siteName) {
        // Create a safe directory name from the site name
        siteId = siteName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "_")
          .replace(/_+/g, "_")
          .substring(0, 30);

        // Check if directory already exists, append number if needed
        let counter = 1;
        let tempSiteId = siteId;
        while (true) {
          try {
            await fs.access(path.join(this.outputDir, tempSiteId));
            // Directory exists, try with counter
            tempSiteId = `${siteId}${counter}`;
            counter++;
          } catch (error) {
            // Directory doesn't exist, we can use this name
            siteId = tempSiteId;
            break;
          }
        }
      } else {
        // Fallback to timestamp
        siteId = Date.now().toString();
      }

      const siteDir = path.join(this.outputDir, siteId);
      await this.ensureDirectoryExists(siteDir);
      await this.ensureDirectoryExists(path.join(siteDir, "assets"));

      // Download and replace CSS files
      const cssLinks = $('link[rel="stylesheet"]');
      for (let i = 0; i < cssLinks.length; i++) {
        const link = cssLinks.eq(i);
        const href = link.attr("href");
        if (href) {
          const localPath = await this.downloadAsset(href, targetUrl, siteDir);
          link.attr("href", localPath);
        }
      }

      // Download and replace JavaScript files
      const scriptTags = $("script[src]");
      for (let i = 0; i < scriptTags.length; i++) {
        const script = scriptTags.eq(i);
        const src = script.attr("src");
        if (src && !src.startsWith("http")) {
          const localPath = await this.downloadAsset(src, targetUrl, siteDir);
          script.attr("src", localPath);
        }
      }

      // Download and replace images
      const images = $("img[src]");
      for (let i = 0; i < images.length; i++) {
        const img = images.eq(i);
        const src = img.attr("src");
        if (src) {
          const localPath = await this.downloadAsset(src, targetUrl, siteDir);
          img.attr("src", localPath);
        }
      }

      // Extract and save inline styles
      const inlineStyles = [];
      $("style").each((i, elem) => {
        inlineStyles.push($(elem).html());
      });

      // Save the modified HTML
      const finalHtml = $.html();
      await fs.writeFile(path.join(siteDir, "index.html"), finalHtml);

      // Save extracted styles to a separate file for easier editing
      if (inlineStyles.length > 0) {
        const combinedStyles = inlineStyles.join("\n\n");
        await fs.writeFile(
          path.join(siteDir, "extracted-styles.css"),
          combinedStyles
        );
      }

      // Save metadata
      const metadata = {
        originalUrl: targetUrl,
        siteName: siteName || "",
        clonedAt: new Date().toISOString(),
        siteId: siteId,
        method: "playwright",
        assets: await this.getAssetsList(path.join(siteDir, "assets")),
      };
      await fs.writeFile(
        path.join(siteDir, "metadata.json"),
        JSON.stringify(metadata, null, 2)
      );

      return {
        success: true,
        siteId: siteId,
        path: siteDir,
        metadata: metadata,
        method: "playwright",
      };
    } catch (error) {
      console.error("Cloning error:", error);
      console.error("Error stack:", error.stack);
      return {
        success: false,
        error: error.message,
        details: error.code || "Unknown error code",
        method: "playwright",
      };
    } finally {
      if (browser) {
        try {
          await browser.close();
          console.log("Browser closed successfully");
        } catch (closeError) {
          console.error("Error closing browser:", closeError);
        }
      }
    }
  }

  async cloneWithAxios(targetUrl, siteName = "") {
    console.log(
      `Using axios fallback method for ${targetUrl} with name ${siteName}`
    );

    try {
      // Fetch the HTML with axios
      const response = await axios.get(targetUrl, {
        timeout: 30000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
        },
        maxRedirects: 5,
        validateStatus: function (status) {
          return status < 500;
        },
      });

      const html = response.data;
      console.log("HTML fetched successfully with axios");

      // Parse with Cheerio for manipulation
      const $ = cheerio.load(html);

      // Create output directory with site name only
      let siteId;
      if (siteName) {
        // Create a safe directory name from the site name
        siteId = siteName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "_")
          .replace(/_+/g, "_")
          .substring(0, 30);

        // Check if directory already exists, append number if needed
        let counter = 1;
        let tempSiteId = siteId;
        while (true) {
          try {
            await fs.access(path.join(this.outputDir, tempSiteId));
            // Directory exists, try with counter
            tempSiteId = `${siteId}${counter}`;
            counter++;
          } catch (error) {
            // Directory doesn't exist, we can use this name
            siteId = tempSiteId;
            break;
          }
        }
      } else {
        // Fallback to timestamp
        siteId = Date.now().toString();
      }

      const siteDir = path.join(this.outputDir, siteId);
      await this.ensureDirectoryExists(siteDir);
      await this.ensureDirectoryExists(path.join(siteDir, "assets"));

      // Download and replace CSS files
      const cssLinks = $('link[rel="stylesheet"]');
      for (let i = 0; i < cssLinks.length; i++) {
        const link = cssLinks.eq(i);
        const href = link.attr("href");
        if (href) {
          const localPath = await this.downloadAsset(href, targetUrl, siteDir);
          link.attr("href", localPath);
        }
      }

      // Download and replace JavaScript files
      const scriptTags = $("script[src]");
      for (let i = 0; i < scriptTags.length; i++) {
        const script = scriptTags.eq(i);
        const src = script.attr("src");
        if (src && !src.startsWith("http")) {
          const localPath = await this.downloadAsset(src, targetUrl, siteDir);
          script.attr("src", localPath);
        }
      }

      // Download and replace images
      const images = $("img[src]");
      for (let i = 0; i < images.length; i++) {
        const img = images.eq(i);
        const src = img.attr("src");
        if (src) {
          const localPath = await this.downloadAsset(src, targetUrl, siteDir);
          img.attr("src", localPath);
        }
      }

      // Extract and save inline styles
      const inlineStyles = [];
      $("style").each((i, elem) => {
        inlineStyles.push($(elem).html());
      });

      // Save the modified HTML
      const finalHtml = $.html();
      await fs.writeFile(path.join(siteDir, "index.html"), finalHtml);

      // Save extracted styles to a separate file for easier editing
      if (inlineStyles.length > 0) {
        const combinedStyles = inlineStyles.join("\n\n");
        await fs.writeFile(
          path.join(siteDir, "extracted-styles.css"),
          combinedStyles
        );
      }

      // Save metadata
      const metadata = {
        originalUrl: targetUrl,
        siteName: siteName || "",
        clonedAt: new Date().toISOString(),
        siteId: siteId,
        method: "axios-fallback",
        assets: await this.getAssetsList(path.join(siteDir, "assets")),
      };
      await fs.writeFile(
        path.join(siteDir, "metadata.json"),
        JSON.stringify(metadata, null, 2)
      );

      return {
        success: true,
        siteId: siteId,
        path: siteDir,
        metadata: metadata,
        method: "axios-fallback",
      };
    } catch (error) {
      console.error("Axios cloning error:", error);
      return {
        success: false,
        error: error.message,
        method: "axios-fallback",
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

app.post("/clone-website", async (req, res) => {
  const { url, name } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  if (!name) {
    return res.status(400).json({ error: "Website name is required" });
  }

  console.log(`Starting to clone website: ${url}`);

  try {
    const result = await cloner.cloneWebsite(url, name);
    console.log(`Clone result:`, result);
    res.json(result);
  } catch (error) {
    console.error("API endpoint error:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

// Check if a website name already exists
app.get("/check-website-name/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const safeName = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .substring(0, 30);

    // Check if directory exists directly
    try {
      await fs.access(path.join(cloner.outputDir, safeName));
      // If we get here, the directory exists
      res.json({ exists: true });
    } catch (error) {
      // Directory doesn't exist
      res.json({ exists: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/cloned-sites", async (req, res) => {
  try {
    const sites = await fs.readdir(cloner.outputDir);
    const sitesList = [];

    for (const siteId of sites) {
      try {
        const metadataPath = path.join(
          cloner.outputDir,
          siteId,
          "metadata.json"
        );
        const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
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

app.get("/preview/:siteId", async (req, res) => {
  const { siteId } = req.params;
  const htmlPath = path.join(cloner.outputDir, siteId, "index.html");

  try {
    let html = await fs.readFile(htmlPath, "utf8");

    // Fix asset paths to work with our server setup
    html = html.replace(
      /src="\.\/assets\//g,
      `src="/cloned-sites/${siteId}/assets/`
    );
    html = html.replace(
      /href="\.\/assets\//g,
      `href="/cloned-sites/${siteId}/assets/`
    );
    html = html.replace(
      /url\(\.\/assets\//g,
      `url(/cloned-sites/${siteId}/assets/`
    );

    // Fix custom CSS path
    html = html.replace(
      /href="\.\/custom-colors\.css"/g,
      `href="/cloned-sites/${siteId}/custom-colors.css"`
    );

    // Add base tag to fix relative paths
    html = html.replace(
      "<head>",
      `<head><base href="/cloned-sites/${siteId}/">`
    );

    // Fix iframe embedding issues
    html = html.replace(
      "<head>",
      '<head><meta http-equiv="Content-Security-Policy" content="frame-ancestors \'self\';">'
    );

    res.send(html);
  } catch (error) {
    res.status(404).json({ error: "Site not found" });
  }
});

// Serve static files
app.use("/public", express.static(path.join(__dirname, "public")));

// Serve assets for each cloned site
app.use("/cloned-sites/:siteId/assets", (req, res, next) => {
  const { siteId } = req.params;
  const assetsPath = path.join(__dirname, "cloned_sites", siteId, "assets");
  express.static(assetsPath)(req, res, next);
});

// Use editor routes first (important for route priority)
const editorRoutes = require("./routes/editor");
app.use("/", editorRoutes);

// We no longer need this route as we'll use the dynamic routing below

// Simple dynamic routing: serve cloned sites directly by folder name (dynamic routes )
app.use("/:siteName", async (req, res, next) => {
  const { siteName } = req.params;

  // Skip if this is a known route or file extension
  if (
    siteName.includes(".") ||
    [
      "editor",
      "api",
      "public",
      "cloned-sites",
      "clone-website",
      "preview",
      "site",
    ].includes(siteName)
  ) {
    return next();
  }

  try {
    // Check if site folder exists
    const sitePath = path.join(__dirname, "cloned_sites", siteName);
    await fs.access(sitePath);

    // Serve the entire folder as static files
    express.static(sitePath)(req, res, next);
  } catch (error) {
    // Site folder doesn't exist, continue to next middleware
    next();
  }
});

// Serve entire cloned site directories for any other files
app.use("/cloned-sites/:siteId", (req, res, next) => {
  const { siteId } = req.params;
  const sitePath = path.join(__dirname, "cloned_sites", siteId);
  express.static(sitePath)(req, res, next);
});

// Serve the landing page
app.get("/", async (req, res) => {
  try {
    const htmlPath = path.join(__dirname, "public", "index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    res.send(html);
  } catch (error) {
    res.status(500).send("Could not load landing page");
  }
});

// Serve the create ads page
app.get("/create-ads", async (req, res) => {
  try {
    const htmlPath = path.join(__dirname, "public", "create-ads.html");
    const html = await fs.readFile(htmlPath, "utf8");
    res.send(html);
  } catch (error) {
    res.status(500).send("Could not load create ads page");
  }
});

// Serve the approve ads page
app.get("/approve-ads", async (req, res) => {
  try {
    const htmlPath = path.join(__dirname, "public", "approve-ads.html");
    const html = await fs.readFile(htmlPath, "utf8");
    res.send(html);
  } catch (error) {
    res.status(500).send("Could not load approve ads page");
  }
});

// API endpoint to create ads
app.post(
  "/api/create-ads",
  upload.fields([
    { name: "researchDoc", maxCount: 1 },
    { name: "referenceImage", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("🚀 Starting ad creation process...");

      const { landingPage, creativeCount } = req.body;
      const researchDoc = req.files.researchDoc?.[0];
      const referenceImage = req.files.referenceImage?.[0];

      // Validate inputs
      if (!landingPage) {
        return res.status(400).json({
          success: false,
          error: "Landing page selection is required",
        });
      }

      if (!researchDoc) {
        return res.status(400).json({
          success: false,
          error: "Research document is required",
        });
      }

      if (!referenceImage) {
        return res.status(400).json({
          success: false,
          error: "Reference image is required",
        });
      }

      console.log(`📋 Processing: ${researchDoc.originalname}`);
      console.log(`🖼️ Reference image: ${referenceImage.originalname}`);
      console.log(`📄 Landing page: ${landingPage}`);
      console.log(`🎯 Creative count: ${creativeCount}`);

      // Step 1: Process research document
      const documentResult = await processDocumentForAI(researchDoc.path);

      if (!documentResult.success) {
        return res.status(400).json({
          success: false,
          error: `Failed to process research document: ${documentResult.error}`,
        });
      }

      // Step 2: Get landing page content
      const landingPageContent = await getLandingPageContent(landingPage);

      // Step 3: Analyze reference image (placeholder for now)
      const imageAnalysis = `Reference image: ${referenceImage.originalname} (${referenceImage.mimetype})`;

      // Step 4: Generate creatives with AI
      const aiInputs = {
        landingPageContent: landingPageContent,
        researchText: documentResult.text,
        imageAnalysis: imageAnalysis,
        creativeCount: parseInt(creativeCount) || 10,
      };

      const result = await generateCreatives(aiInputs);

      // Step 5: Clean up uploaded files
      try {
        await fs.unlink(researchDoc.path);
        await fs.unlink(referenceImage.path);
        console.log("🗑️ Cleaned up uploaded files");
      } catch (cleanupError) {
        console.warn("⚠️ Could not clean up files:", cleanupError);
      }

      // Step 6: Return results
      res.json({
        success: true,
        message: `Generated ${result.creatives.length} high-quality ads`,
        creatives: result.creatives,
        stats: {
          totalGenerated: result.totalGenerated,
          highQuality: result.highQuality,
          documentAnalysis: documentResult.analysis,
        },
      });
    } catch (error) {
      console.error("❌ Ad creation failed:", error);

      // Clean up files on error
      if (req.files) {
        Object.values(req.files)
          .flat()
          .forEach(async (file) => {
            try {
              await fs.unlink(file.path);
            } catch (cleanupError) {
              // Ignore cleanup errors
            }
          });
      }

      res.status(500).json({
        success: false,
        error: `Ad creation failed: ${error.message}`,
      });
    }
  }
);

// API endpoint to sync approved ads to Google Drive
app.post("/api/sync-to-drive", async (req, res) => {
  try {
    console.log("📤 Starting Google Drive sync...");
    const { approvedAds, brandName, campaignName } = req.body;

    // Validate input
    if (
      !approvedAds ||
      !Array.isArray(approvedAds) ||
      approvedAds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error: "No approved ads provided for sync",
      });
    }

    console.log(
      `📤 Syncing ${approvedAds.length} approved ads to Google Drive...`
    );
    console.log(`📋 Brand: ${brandName || "Default Brand"}`);
    console.log(`📋 Campaign: ${campaignName || "Default Campaign"}`);

    // Test Google Drive connection first
    const connectionTest = await driveService.testConnection();
    if (!connectionTest) {
      throw new Error(
        "Google Drive connection failed. Please check your credentials."
      );
    }

    // Upload approved ads to Google Drive
    const results = await driveService.uploadApprovedAds(
      approvedAds,
      brandName || "Default Brand",
      campaignName || `Campaign_${new Date().toISOString().split("T")[0]}`
    );

    const successCount = results.filter((r) => r.status === "success").length;
    const failedCount = results.filter((r) => r.status === "failed").length;

    console.log(
      `✅ Google Drive sync completed: ${successCount} success, ${failedCount} failed`
    );

    res.json({
      success: true,
      message: `Successfully synced ${successCount} out of ${approvedAds.length} ads to Google Drive`,
      results: results,
      stats: {
        total: approvedAds.length,
        successful: successCount,
        failed: failedCount,
        brandName: brandName || "Default Brand",
        campaignName:
          campaignName || `Campaign_${new Date().toISOString().split("T")[0]}`,
        syncDate: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("❌ Google Drive sync failed:", error);
    res.status(500).json({
      success: false,
      error: `Google Drive sync failed: ${error.message}`,
    });
  }
});

// API endpoint to test Google Drive connection
app.get("/api/test-drive-connection", async (req, res) => {
  try {
    const isConnected = await driveService.testConnection();

    if (isConnected) {
      res.json({
        success: true,
        message: "Google Drive connection successful",
        connected: true,
      });
    } else {
      res.json({
        success: false,
        message: "Google Drive connection failed",
        connected: false,
      });
    }
  } catch (error) {
    console.error("❌ Drive connection test failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      connected: false,
    });
  }
});

// Helper function to get landing page content
async function getLandingPageContent(siteId) {
  try {
    const htmlPath = path.join(__dirname, "cloned_sites", siteId, "index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    const $ = cheerio.load(html);

    // Extract text content from the page
    const content = {
      title: $("title").text() || $("h1").first().text(),
      headings: $("h1, h2, h3")
        .map((i, el) => $(el).text())
        .get(),
      paragraphs: $("p")
        .map((i, el) => $(el).text())
        .get(),
      buttons: $('button, .btn, a[class*="btn"]')
        .map((i, el) => $(el).text())
        .get(),
    };

    // Combine into a single text block
    const combinedContent = [
      content.title,
      ...content.headings,
      ...content.paragraphs,
      ...content.buttons,
    ]
      .filter((text) => text && text.trim().length > 0)
      .join(" ");

    console.log(
      `📄 Extracted ${combinedContent.length} characters from landing page`
    );
    return combinedContent;
  } catch (error) {
    console.error("❌ Failed to get landing page content:", error);
    throw new Error(`Could not read landing page: ${error.message}`);
  }
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Website Cloner API running on port ${PORT}`);

  // Initialize services
  await initializeServices();

  console.log(`\n📝 Available endpoints:`);
  console.log(`   • POST /clone-website - Clone a website`);
  console.log(`   • GET /cloned-sites - List all cloned sites`);
  console.log(`   • GET /preview/:siteId - Preview a cloned site`);
  console.log(`   • GET /editor - Open the Editor Dashboard`);
  console.log(`   • GET /create-ads - Create AI-powered ads`);
  console.log(`   • GET /approve-ads - Ad approval interface`);
  console.log(
    `   • POST /api/sync-to-drive - Sync approved ads to Google Drive`
  );
  console.log(
    `   • GET /api/test-drive-connection - Test Google Drive connection`
  );
});

module.exports = { WebsiteCloner, app };
