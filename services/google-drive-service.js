const { google } = require("googleapis");
const fs = require("fs").promises;
const path = require("path");

class GoogleDriveService {
  constructor() {
    this.drive = null;
    this.auth = null;
  }

  async initialize() {
    try {
      this.auth = new google.auth.OAuth2(
        process.env.GOOGLE_DRIVE_CLIENT_ID,
        process.env.GOOGLE_DRIVE_CLIENT_SECRET,
        process.env.GOOGLE_DRIVE_REDIRECT_URI
      );

      this.auth.setCredentials({
        refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
      });

      this.drive = google.drive({ version: "v3", auth: this.auth });

      console.log("✅ Google Drive service initialized");
      return true;
    } catch (error) {
      console.error("❌ Failed to initialize Google Drive service:", error);
      return false;
    }
  }

  async findOrCreateFolder(folderName, parentFolderId = null) {
    try {
      // Search for existing folder
      const query = parentFolderId
        ? `name='${folderName}' and parents in '${parentFolderId}' and mimeType='application/vnd.google-apps.folder'`
        : `name='${folderName}' and mimeType='application/vnd.google-apps.folder'`;

      const response = await this.drive.files.list({
        q: query,
        fields: "files(id, name)",
      });

      if (response.data.files.length > 0) {
        console.log(`📁 Found existing folder: ${folderName}`);
        return response.data.files[0].id;
      }

      // Create new folder
      const folderMetadata = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentFolderId ? [parentFolderId] : undefined,
      };

      const folder = await this.drive.files.create({
        resource: folderMetadata,
        fields: "id",
      });

      console.log(
        `📁 Created new folder: ${folderName} (ID: ${folder.data.id})`
      );
      return folder.data.id;
    } catch (error) {
      console.error(`❌ Error creating folder ${folderName}:`, error);
      throw error;
    }
  }

  async createBrandFolder(brandName, campaignName = null) {
    try {
      // Create folder structure: /Creatives/{brandName}/{campaignName}/{date}
      const creativesFolder = await this.findOrCreateFolder("Creatives");
      const brandFolder = await this.findOrCreateFolder(
        brandName,
        creativesFolder
      );

      let targetFolder = brandFolder;
      let folderPath = `Creatives/${brandName}`;

      // If campaign name is provided, create campaign folder
      if (campaignName && campaignName.trim() !== "") {
        const campaignFolder = await this.findOrCreateFolder(
          campaignName,
          brandFolder
        );
        targetFolder = campaignFolder;
        folderPath += `/${campaignName}`;
      }

      const dateFolder = await this.findOrCreateFolder(
        new Date().toISOString().split("T")[0],
        targetFolder
      );

      console.log(
        `📁 Brand folder structure ready: ${folderPath}/${
          new Date().toISOString().split("T")[0]
        }`
      );
      return dateFolder;
    } catch (error) {
      console.error("❌ Error creating brand folder structure:", error);
      throw error;
    }
  }

  async uploadImage(ad, folderId) {
    try {
      if (!ad.imageUrl) {
        throw new Error("No image URL found in ad");
      }

      // Convert base64 image to buffer
      const base64Data = ad.imageUrl.split(",")[1];
      const imageBuffer = Buffer.from(base64Data, "base64");

      // Create a temporary file
      const tempFileName = `temp_${ad.id}.png`;
      const tempFilePath = path.join(__dirname, "..", "uploads", tempFileName);

      await fs.writeFile(tempFilePath, imageBuffer);

      // Upload to Google Drive
      const fileMetadata = {
        name: `${ad.id}_${
          ad.headline?.replace(/[^a-zA-Z0-9]/g, "_") || "ad"
        }.png`,
        parents: [folderId],
      };

      const media = {
        mimeType: "image/png",
        body: require("fs").createReadStream(tempFilePath),
      };

      const response = await this.drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: "id, webViewLink, webContentLink",
      });

      // Clean up temp file
      await fs.unlink(tempFilePath).catch(() => {});

      console.log(`🖼️ Uploaded image: ${fileMetadata.name}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Error uploading image for ad ${ad.id}:`, error);
      throw error;
    }
  }

  async uploadMetadata(ad, folderId) {
    try {
      // Create metadata object
      const metadata = {
        id: ad.id,
        headline: ad.headline,
        description: ad.description,
        cta: ad.cta,
        platform: ad.platform,
        score: ad.score,
        type: ad.type,
        createdAt: ad.createdAt || new Date().toISOString(),
        approvedAt: new Date().toISOString(),
        editHistory: ad.editHistory || [],
        tags: this.extractTags(ad),
      };

      // Create temporary JSON file
      const tempFileName = `temp_${ad.id}_metadata.json`;
      const tempFilePath = path.join(__dirname, "..", "uploads", tempFileName);

      await fs.writeFile(tempFilePath, JSON.stringify(metadata, null, 2));

      // Upload to Google Drive
      const fileMetadata = {
        name: `${ad.id}_metadata.json`,
        parents: [folderId],
      };

      const media = {
        mimeType: "application/json",
        body: require("fs").createReadStream(tempFilePath),
      };

      const response = await this.drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: "id, webViewLink, webContentLink",
      });

      // Clean up temp file
      await fs.unlink(tempFilePath).catch(() => {});

      console.log(`📄 Uploaded metadata: ${fileMetadata.name}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Error uploading metadata for ad ${ad.id}:`, error);
      throw error;
    }
  }

  extractTags(ad) {
    const tags = [];

    // Extract tags from headline and description
    const text = `${ad.headline || ""} ${ad.description || ""}`.toLowerCase();

    // Common fitness/marketing tags
    const tagKeywords = [
      "fitness",
      "muscle",
      "protein",
      "workout",
      "gym",
      "strength",
      "health",
      "nutrition",
      "supplement",
      "energy",
      "recovery",
      "sale",
      "discount",
      "limited",
      "exclusive",
      "new",
      "premium",
    ];

    tagKeywords.forEach((keyword) => {
      if (text.includes(keyword)) {
        tags.push(keyword);
      }
    });

    // Add platform as tag
    if (ad.platform) {
      tags.push(ad.platform);
    }

    return tags;
  }

  async uploadApprovedAds(approvedAds, brandName, campaignName) {
    try {
      console.log(
        `📤 Starting Google Drive sync for ${approvedAds.length} approved ads...`
      );

      const folderId = await this.createBrandFolder(brandName, campaignName);
      const results = [];

      for (let i = 0; i < approvedAds.length; i++) {
        const ad = approvedAds[i];
        console.log(`📤 Syncing ad ${i + 1}/${approvedAds.length}: ${ad.id}`);

        try {
          // Upload image
          const imageResult = await this.uploadImage(ad, folderId);

          // Upload metadata JSON
          const metadataResult = await this.uploadMetadata(ad, folderId);

          results.push({
            adId: ad.id,
            headline: ad.headline,
            imageUrl: imageResult.webViewLink,
            imageDownloadUrl: imageResult.webContentLink,
            metadataUrl: metadataResult.webViewLink,
            metadataDownloadUrl: metadataResult.webContentLink,
            status: "success",
          });

          console.log(`✅ Successfully synced ad: ${ad.id}`);
        } catch (error) {
          console.error(`❌ Failed to sync ad ${ad.id}:`, error);
          results.push({
            adId: ad.id,
            headline: ad.headline,
            status: "failed",
            error: error.message,
          });
        }
      }

      // Create summary file
      await this.createSyncSummary(results, folderId, brandName, campaignName);

      const successCount = results.filter((r) => r.status === "success").length;
      console.log(
        `✅ Google Drive sync completed: ${successCount}/${approvedAds.length} ads synced successfully`
      );

      return results;
    } catch (error) {
      console.error("❌ Google Drive sync failed:", error);
      throw error;
    }
  }

  async createSyncSummary(results, folderId, brandName, campaignName) {
    try {
      const summary = {
        syncDate: new Date().toISOString(),
        brandName: brandName,
        campaignName: campaignName,
        totalAds: results.length,
        successfulUploads: results.filter((r) => r.status === "success").length,
        failedUploads: results.filter((r) => r.status === "failed").length,
        results: results,
      };

      const tempFileName = `temp_sync_summary.json`;
      const tempFilePath = path.join(__dirname, "..", "uploads", tempFileName);

      await fs.writeFile(tempFilePath, JSON.stringify(summary, null, 2));

      const fileMetadata = {
        name: `sync_summary_${new Date().toISOString().split("T")[0]}.json`,
        parents: [folderId],
      };

      const media = {
        mimeType: "application/json",
        body: require("fs").createReadStream(tempFilePath),
      };

      await this.drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: "id",
      });

      // Clean up temp file
      await fs.unlink(tempFilePath).catch(() => {});

      console.log("📊 Created sync summary file");
    } catch (error) {
      console.error("❌ Error creating sync summary:", error);
    }
  }

  async testConnection() {
    try {
      const response = await this.drive.files.list({
        pageSize: 1,
        fields: "files(id, name)",
      });

      console.log("✅ Google Drive connection test successful");
      return true;
    } catch (error) {
      console.error("❌ Google Drive connection test failed:", error);
      return false;
    }
  }
}

module.exports = { GoogleDriveService };
