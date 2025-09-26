const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cheerio = require("cheerio");
const multer = require("multer");

const router = express.Router();
const CLONED_SITES_DIR = "./cloned_sites";

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const siteId = req.params.siteId;
    const assetsPath = path.join(CLONED_SITES_DIR, siteId, "assets");
    cb(null, assetsPath);
  },
  filename: function (req, file, cb) {
    // Generate unique filename to avoid conflicts
    const timestamp = Date.now();
    const originalName = file.originalname;
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension);
    cb(null, `${baseName}_${timestamp}${extension}`);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Check if file is an image
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
});

// Serve the editor dashboard
router.get("/editor", async (req, res) => {
  try {
    const htmlPath = path.join(__dirname, "..", "public", "editor.html");
    let html = await fs.readFile(htmlPath, "utf8");

    // If siteId is provided in query params, inject script to auto-select that site
    const { siteId } = req.query;
    if (siteId) {
      const autoSelectScript = `
                <script>
                    // Auto-select site from URL parameter (only if no site is saved in localStorage)
                    document.addEventListener('DOMContentLoaded', () => {
                        const urlSiteId = "${siteId}";
                        const savedSiteId = localStorage.getItem('selectedSiteId');
                        
                        console.log('URL siteId:', urlSiteId, 'localStorage siteId:', savedSiteId);
                        
                        // Always use URL parameter when provided (for newly cloned sites)
                        if (urlSiteId) {
                            console.log('Using URL parameter for newly cloned site');
                            // Clear localStorage to ensure new site is selected
                            localStorage.removeItem('selectedSiteId');
                            
                            // Wait a bit for sites to load
                            setTimeout(() => {
                                const siteElement = document.querySelector(\`[data-site-id="\${urlSiteId}"]\`);
                                if (siteElement) {
                                    siteElement.click();
                                    // Clear URL parameter after selection
                                    history.replaceState({}, document.title, window.location.pathname);
                                } else {
                                    console.warn(\`Site with ID \${urlSiteId} not found in the site list\`);
                                    // Show a toast message that the site wasn't found
                                    if (window.showToast) {
                                        window.showToast('Requested site not found. Please select a site from the list.', 'error');
                                    }
                                }
                            }, 1000); // Increased timeout to ensure sites are loaded
                        }
                    });
                </script>
            `;
      html = html.replace("</body>", `${autoSelectScript}</body>`);
    }

    res.send(html);
  } catch (error) {
    res.status(500).json({ error: "Could not load editor" });
  }
});

// Get list of cloned sites for editor
router.get("/api/sites", async (req, res) => {
  try {
    const sites = await fs.readdir(CLONED_SITES_DIR);
    const sitesList = [];

    for (const siteId of sites) {
      if (siteId === ".DS_Store") continue;

      try {
        const metadataPath = path.join(
          CLONED_SITES_DIR,
          siteId,
          "metadata.json"
        );
        const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
        sitesList.push({
          siteId,
          siteName: metadata.siteName || siteId,
          originalUrl: metadata.originalUrl,
          clonedAt: metadata.clonedAt,
          lastEdited: metadata.lastEdited || null,
        });
      } catch (error) {
        console.warn(`Could not read metadata for site ${siteId}`);
      }
    }

    res.json(sitesList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get site content for editing
router.get("/api/sites/:siteId/content", async (req, res) => {
  const { siteId } = req.params;

  try {
    if (!siteId || siteId === "undefined" || siteId === "null") {
      return res.status(400).json({
        error: "Invalid site ID provided",
        success: false,
      });
    }

    const htmlPath = path.join(CLONED_SITES_DIR, siteId, "index.html");

    // Check if the site directory exists
    try {
      await fs.access(path.join(CLONED_SITES_DIR, siteId));
    } catch (error) {
      return res.status(404).json({
        error: `Site '${siteId}' not found`,
        success: false,
      });
    }

    const html = await fs.readFile(htmlPath, "utf8");
    const $ = cheerio.load(html);

    // Extract text content and styles
    const textElements = [];
    const colorElements = [];

    // Find editable text elements
    $(
      "h1, h2, h3, h4, h5, h6, p, span, a, button, div, li, td, th, label, strong, em, code, pre, blockquote"
    ).each((i, elem) => {
      const $elem = $(elem);
      const text = $elem.text().trim();

      if (text.length > 0 && text.length < 500) {
        // Skip very long text
        const elementId = `text_${i}`;
        $elem.attr("data-editor-id", elementId);

        textElements.push({
          id: elementId,
          tag: elem.tagName.toLowerCase(),
          text: text,
          selector: getElementSelector($elem, i),
        });
      }
    });

    // Find elements with color styles - Enhanced detection
    $("*").each((i, elem) => {
      const $elem = $(elem);
      const style = $elem.attr("style") || "";
      const classes = $elem.attr("class") || "";
      const tag = elem.tagName.toLowerCase();

      // Skip script, style, and meta tags
      if (["script", "style", "meta", "link", "head", "title"].includes(tag))
        return;

      // Check for inline color styles
      const colorMatch = style.match(
        /(color|background-color|border-color|background)\s*:\s*([^;]+)/g
      );
      if (colorMatch) {
        colorMatch.forEach((match, matchIndex) => {
          const [property, value] = match.split(":").map((s) => s.trim());
          const elementId = `color_${i}_${matchIndex}`;
          $elem.attr("data-editor-color-id", elementId);

          colorElements.push({
            id: elementId,
            tag: tag,
            property: property,
            value: value,
            selector: getElementSelector($elem, i),
            classes: classes,
            type: "inline",
          });
        });
      }

      // Detect text elements that likely have color (even without inline styles)
      if (
        [
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "p",
          "span",
          "a",
          "div",
          "button",
          "label",
        ].includes(tag)
      ) {
        const text = $elem.text().trim();
        if (text.length > 0 && text.length < 200) {
          const elementId = `text_color_${i}`;
          $elem.attr("data-editor-text-color-id", elementId);

          colorElements.push({
            id: elementId,
            tag: tag,
            property: "color",
            value: "inherit",
            selector: getElementSelector($elem, i),
            classes: classes,
            type: "text",
            text: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
          });
        }
      }

      // Detect buttons and clickable elements for background colors
      if (
        ["button", "a", "input"].includes(tag) ||
        classes.includes("btn") ||
        classes.includes("button")
      ) {
        const elementId = `bg_color_${i}`;
        $elem.attr("data-editor-bg-color-id", elementId);

        colorElements.push({
          id: elementId,
          tag: tag,
          property: "background-color",
          value: "inherit",
          selector: getElementSelector($elem, i),
          classes: classes,
          type: "background",
          text: $elem.text().trim().substring(0, 30) || `${tag} element`,
        });
      }

      // Detect elements with color-related classes
      if (classes) {
        const colorClasses = classes
          .split(" ")
          .filter(
            (cls) =>
              cls.includes("color") ||
              cls.includes("bg-") ||
              cls.includes("text-") ||
              cls.includes("border-") ||
              cls.match(
                /^(red|blue|green|yellow|purple|pink|gray|black|white|orange)/i
              )
          );

        if (colorClasses.length > 0) {
          const elementId = `class_color_${i}`;
          $elem.attr("data-editor-class-color-id", elementId);

          colorElements.push({
            id: elementId,
            tag: tag,
            property: "class-override",
            value: colorClasses.join(" "),
            selector: getElementSelector($elem, i),
            classes: classes,
            type: "class",
            text:
              $elem.text().trim().substring(0, 30) ||
              `${tag} with color classes`,
          });
        }
      }
    });

    // IMPORTANT: Save the HTML with editor IDs back to the file
    try {
      await fs.writeFile(htmlPath, $.html());
      console.log(`Successfully saved HTML with editor IDs for site ${siteId}`);
    } catch (saveError) {
      console.error(
        `Failed to save HTML with editor IDs for site ${siteId}:`,
        saveError
      );
      throw saveError;
    }

    // Fix asset paths for preview
    let htmlPreview = $.html();
    htmlPreview = htmlPreview.replace(
      /src="\.\/assets\//g,
      `/cloned-sites/${siteId}/assets/`
    );
    htmlPreview = htmlPreview.replace(
      /href="\.\/assets\//g,
      `/cloned-sites/${siteId}/assets/`
    );
    htmlPreview = htmlPreview.replace(
      /url\(\.\/assets\//g,
      `url(/cloned-sites/${siteId}/assets/`
    );
    htmlPreview = htmlPreview.replace(
      "<head>",
      `<head><base href="/cloned-sites/${siteId}/">`
    );
    htmlPreview = htmlPreview.replace(
      "<head>",
      '<head><meta http-equiv="Content-Security-Policy" content="frame-ancestors \'self\';">'
    );

    res.json({
      textElements: textElements.slice(0, 200), // Limit for performance
      colorElements: colorElements.slice(0, 100),
      htmlPreview: htmlPreview,
    });
  } catch (error) {
    console.error(`Error loading site content for ${siteId}:`, error);
    res.status(500).json({
      error: `Failed to load site content: ${error.message}`,
      success: false,
    });
  }
});

// Update text content
router.post("/api/sites/:siteId/text", async (req, res) => {
  const { siteId } = req.params;
  const { elementId, newText } = req.body;

  try {
    const htmlPath = path.join(CLONED_SITES_DIR, siteId, "index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    const $ = cheerio.load(html);

    // Find and update the element
    const element = $(`[data-editor-id="${elementId}"]`);
    console.log(
      `Element update request - Selector: "${selector}", ElementId: "${elementId}", Action: "${action}"`
    );

    if (element.length > 0) {
      console.log(
        `Original text: "${element.text()}", updating to: "${newText}"`
      );
      element.text(newText);

      // Save the updated HTML
      await fs.writeFile(htmlPath, $.html());

      // Update metadata
      await updateSiteMetadata(siteId);

      res.json({ success: true, message: "Text updated successfully" });
    } else {
      // Debug: Check what data-editor-id attributes exist
      const allEditorElements = $("[data-editor-id]");
      console.log(
        `Available editor IDs: ${allEditorElements
          .map((i, el) => $(el).attr("data-editor-id"))
          .get()
          .join(", ")}`
      );
      res.status(404).json({
        error: `Element not found. Available IDs: ${allEditorElements
          .map((i, el) => $(el).attr("data-editor-id"))
          .get()
          .join(", ")}`,
      });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to update text: " + error.message });
  }
});

// Update color styles
router.post("/api/sites/:siteId/color", async (req, res) => {
  const { siteId } = req.params;
  const { elementId, property, newColor, type } = req.body;

  try {
    const htmlPath = path.join(CLONED_SITES_DIR, siteId, "index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    const $ = cheerio.load(html);

    let element;
    let found = false;

    // Find element based on type
    if (elementId.startsWith("text_color_")) {
      element = $(`[data-editor-text-color-id="${elementId}"]`);
    } else if (elementId.startsWith("bg_color_")) {
      element = $(`[data-editor-bg-color-id="${elementId}"]`);
    } else if (elementId.startsWith("class_color_")) {
      element = $(`[data-editor-class-color-id="${elementId}"]`);
    } else {
      element = $(`[data-editor-color-id="${elementId}"]`);
    }

    if (element.length > 0) {
      let currentStyle = element.attr("style") || "";

      // Handle different types of color updates
      if (type === "class" || property === "class-override") {
        // For class-based colors, we use CSS injection
        await injectCustomCSS(siteId, elementId, property, newColor, element);
      } else {
        // For direct style properties
        const targetProperty =
          type === "text"
            ? "color"
            : type === "background"
            ? "background-color"
            : property;

        // Remove existing property if it exists
        currentStyle = currentStyle.replace(
          new RegExp(`${targetProperty}\\s*:[^;]*;?`, "g"),
          ""
        );

        // Add new color property with !important to override classes
        currentStyle += `${targetProperty}: ${newColor} !important;`;
        element.attr("style", currentStyle);
      }

      found = true;
    }

    if (found) {
      // Save the updated HTML
      await fs.writeFile(htmlPath, $.html());

      // Update metadata
      await updateSiteMetadata(siteId);

      res.json({ success: true, message: "Color updated successfully" });
    } else {
      res.status(404).json({ error: "Element not found" });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to update color: " + error.message });
  }
});

// Helper function to inject custom CSS for class-based overrides
async function injectCustomCSS(siteId, elementId, property, newColor, element) {
  const customCSSPath = path.join(
    CLONED_SITES_DIR,
    siteId,
    "custom-colors.css"
  );

  let cssContent = "";
  try {
    cssContent = await fs.readFile(customCSSPath, "utf8");
  } catch (error) {
    // File doesn't exist yet, start with empty content
  }

  // Generate a unique selector for this element
  const uniqueSelector = `[data-editor-class-color-id="${elementId}"]`;

  // Remove any existing rule for this element
  cssContent = cssContent.replace(
    new RegExp(
      `${uniqueSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*{[^}]*}`,
      "g"
    ),
    ""
  );

  // Add new rule
  const newRule = `${uniqueSelector} { color: ${newColor} !important; background-color: ${newColor} !important; }`;
  cssContent += "\n" + newRule;

  // Save the custom CSS file
  await fs.writeFile(customCSSPath, cssContent);

  // Add CSS link to HTML if not present
  const htmlPath = path.join(CLONED_SITES_DIR, siteId, "index.html");
  const html = await fs.readFile(htmlPath, "utf8");
  const $ = cheerio.load(html);

  if (!$('link[href="./custom-colors.css"]').length) {
    $("head").append('<link rel="stylesheet" href="./custom-colors.css">');
    await fs.writeFile(htmlPath, $.html());
  }
}

// Batch save changes
router.post("/api/sites/:siteId/save", async (req, res) => {
  const { siteId } = req.params;
  const { textChanges, colorChanges } = req.body;

  try {
    const htmlPath = path.join(CLONED_SITES_DIR, siteId, "index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    const $ = cheerio.load(html);

    // Apply text changes
    if (textChanges) {
      for (const change of textChanges) {
        const element = $(`[data-editor-id="${change.elementId}"]`);
        if (element.length > 0) {
          element.text(change.newText);
        }
      }
    }

    // Apply color changes
    if (colorChanges) {
      for (const change of colorChanges) {
        let element;
        const { elementId, property, newColor, type } = change;

        // Find element based on type
        if (elementId.startsWith("text_color_")) {
          element = $(`[data-editor-text-color-id="${elementId}"]`);
        } else if (elementId.startsWith("bg_color_")) {
          element = $(`[data-editor-bg-color-id="${elementId}"]`);
        } else if (elementId.startsWith("class_color_")) {
          element = $(`[data-editor-class-color-id="${elementId}"]`);
        } else {
          element = $(`[data-editor-color-id="${elementId}"]`);
        }

        if (element.length > 0) {
          if (type === "class" || property === "class-override") {
            // Handle class-based colors with CSS injection
            await injectCustomCSS(
              siteId,
              elementId,
              property,
              newColor,
              element
            );
          } else {
            // Handle direct style properties
            let currentStyle = element.attr("style") || "";
            const targetProperty =
              type === "text"
                ? "color"
                : type === "background"
                ? "background-color"
                : property;

            currentStyle = currentStyle.replace(
              new RegExp(`${targetProperty}\\s*:[^;]*;?`, "g"),
              ""
            );
            currentStyle += `${targetProperty}: ${newColor} !important;`;
            element.attr("style", currentStyle);
          }
        }
      }
    }

    // Create backup
    const backupPath = path.join(
      CLONED_SITES_DIR,
      siteId,
      `backup_${Date.now()}.html`
    );
    try {
      const originalHtml = await fs.readFile(htmlPath, "utf8");
      await fs.writeFile(backupPath, originalHtml);
    } catch (backupError) {
      console.warn("Could not create backup:", backupError);
    }

    // Save the updated HTML
    await fs.writeFile(htmlPath, $.html());

    // Update metadata
    await updateSiteMetadata(siteId);

    res.json({
      success: true,
      message: "All changes saved successfully",
      changesApplied: {
        textChanges: textChanges?.length || 0,
        colorChanges: colorChanges?.length || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to save changes: " + error.message });
  }
});

// Helper functions
function getElementSelector($elem, index) {
  const tag = $elem.prop("tagName").toLowerCase();
  const id = $elem.attr("id");
  const classes = $elem.attr("class");

  if (id) return `#${id}`;
  if (classes) {
    // Filter out any temporary or empty classes
    const cleanClasses = classes
      .split(" ")
      .filter(
        (cls) =>
          cls.trim() &&
          cls !== "element-hover-selection" &&
          cls !== "element-selected-selection"
      )
      .join(".");

    if (cleanClasses) {
      return `${tag}.${cleanClasses}`;
    }
  }

  // Generate nth-child selector (consistent with frontend)
  const parent = $elem.parent();
  if (parent.length > 0) {
    const siblings = parent.children();
    const childIndex = siblings.index($elem[0]) + 1; // 1-based index
    return `${tag}:nth-child(${childIndex})`;
  }

  return tag;
}

async function updateSiteMetadata(siteId) {
  try {
    const metadataPath = path.join(CLONED_SITES_DIR, siteId, "metadata.json");
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    metadata.lastEdited = new Date().toISOString();
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.warn("Could not update metadata:", error);
  }
}

// Update individual element (for click-to-select functionality)
router.post("/api/sites/:siteId/element", async (req, res) => {
  const { siteId } = req.params;
  const { selector, action, value, elementId, position } = req.body;

  try {
    console.log(
      `Element update request - Selector: "${selector}", ElementId: "${elementId}", Action: "${action}"`
    );
    if (position) {
      console.log(
        `Position data: textSnippet="${position.textSnippet}", siblingIndex=${position.siblingIndex}`
      );
    }

    const htmlPath = path.join(CLONED_SITES_DIR, siteId, "index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    const $ = cheerio.load(html);

    // Find element by unique data attribute first, then fallback to selector
    let elements = elementId
      ? $(`[data-editor-element-id="${elementId}"]`)
      : $();
    console.log(
      `Found ${elements.length} elements by elementId: "${elementId}"`
    );

    if (elements.length === 0) {
      elements = $(selector);
      console.log(
        `Found ${elements.length} elements by direct selector: "${selector}"`
      );
    }

    // If not found by direct selector, try fallback approaches
    if (elements.length === 0) {
      console.log(`Direct selector failed: ${selector}, trying fallbacks...`);

      // Try finding by nth-child selector with proper context
      const nthChildMatch = selector.match(/^([^:]+):nth-child\((\d+)\)$/);
      if (nthChildMatch) {
        const tagName = nthChildMatch[1];
        const nthIndex = parseInt(nthChildMatch[2]);

        // nth-child is 1-based and considers all sibling elements
        // We need to find the element that is the nth child of its parent
        const candidateElements = $(tagName);

        for (let i = 0; i < candidateElements.length; i++) {
          const elem = candidateElements.eq(i);
          const parent = elem.parent();
          const siblings = parent.children();
          const childIndex = siblings.index(elem[0]) + 1; // Convert to 1-based

          if (childIndex === nthIndex) {
            elements = elem;
            console.log(
              `Found nth-child element: ${tagName}:nth-child(${nthIndex}), actual child position: ${childIndex}`
            );
            break;
          }
        }

        if (elements.length === 0) {
          console.log(
            `nth-child search failed for: ${tagName}:nth-child(${nthIndex})`
          );
        }
      }

      // Try more complex selector patterns
      if (elements.length === 0) {
        // Handle compound selectors like "ul li:nth-child(1)" or "#menu li:nth-child(2)" or "ul.nav li:nth-child(1)"
        const complexMatch = selector.match(
          /^(.+)\s+([^:]+):nth-child\((\d+)\)$/
        );
        if (complexMatch) {
          const parentSelector = complexMatch[1];
          const childTag = complexMatch[2];
          const nthIndex = parseInt(complexMatch[3]);

          const parentElements = $(parentSelector);
          console.log(
            `Trying complex selector: parent="${parentSelector}", child="${childTag}:nth-child(${nthIndex})", found parents: ${parentElements.length}`
          );

          for (let i = 0; i < parentElements.length; i++) {
            const parent = parentElements.eq(i);
            const children = parent.children();

            // Find the nth child that matches the tag
            let matchingChildCount = 0;
            for (let j = 0; j < children.length; j++) {
              const child = children.eq(j);
              const childTagName = child.prop("tagName").toLowerCase();

              if (childTagName === childTag) {
                matchingChildCount++;
                if (matchingChildCount === nthIndex) {
                  elements = child;
                  console.log(
                    `Found complex selector element: ${selector} (child ${
                      j + 1
                    } of parent, ${matchingChildCount}th ${childTag})`
                  );
                  break;
                }
              }
            }

            if (elements.length > 0) break;
          }

          // If still not found, try the original simpler approach
          if (elements.length === 0) {
            for (let i = 0; i < parentElements.length; i++) {
              const parent = parentElements.eq(i);
              const nthChild = parent.children().eq(nthIndex - 1); // Convert to 0-based for .eq()

              if (
                nthChild.length > 0 &&
                nthChild.prop("tagName").toLowerCase() === childTag
              ) {
                elements = nthChild;
                console.log(
                  `Found complex selector element (fallback): ${selector}`
                );
                break;
              }
            }
          }
        }
      }

      // Try finding by tag name only if all other methods failed
      if (elements.length === 0) {
        const tagOnly = selector.split(".")[0].split(":")[0].split(" ").pop(); // Get last tag in case of compound selectors
        elements = $(tagOnly).first();
        console.log(`Trying tag only: ${tagOnly}, found: ${elements.length}`);
      }

      // Try finding by class name without tag
      if (elements.length === 0 && selector.includes(".")) {
        const classSelector = "." + selector.split(".").slice(1).join(".");
        elements = $(classSelector).first();
        console.log(
          `Trying class only: ${classSelector}, found: ${elements.length}`
        );
      }
    }

    if (elements.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Element not found: ${selector}`,
      });
    }

    // If we have multiple elements and position information, try to find the exact one
    let element = elements.first();
    if (elements.length > 1 && position) {
      console.log(
        `Found ${elements.length} elements, using position data to find exact match`
      );

      for (let i = 0; i < elements.length; i++) {
        const candidateElement = elements.eq(i);
        const candidateText = candidateElement.text().trim().substring(0, 50);
        const candidateParent = candidateElement.parent();
        const candidateSiblingIndex = candidateParent
          .children()
          .index(candidateElement[0]);

        // Match by text snippet and sibling position
        if (
          candidateText === position.textSnippet &&
          candidateSiblingIndex === position.siblingIndex
        ) {
          element = candidateElement;
          console.log(
            `Found exact element match using position: index ${candidateSiblingIndex}, text: "${candidateText}"`
          );
          break;
        }
      }

      // Fallback: match by text snippet only
      if (element === elements.first() && position.textSnippet) {
        for (let i = 0; i < elements.length; i++) {
          const candidateElement = elements.eq(i);
          const candidateText = candidateElement.text().trim().substring(0, 50);

          if (candidateText === position.textSnippet) {
            element = candidateElement;
            console.log(
              `Found element match using text snippet: "${candidateText}"`
            );
            break;
          }
        }
      }
    } else if (elements.length > 1) {
      console.log(
        `Found ${elements.length} elements but no position data, using first element`
      );
    }

    switch (action) {
      case "updateText":
        element.text(value);
        break;

      case "updateHtml":
        element.html(value);
        break;

      case "updateCss":
        element.attr("style", value);
        break;

      case "delete":
        element.remove();
        break;

      default:
        return res.status(400).json({
          success: false,
          error: `Unknown action: ${action}`,
        });
    }

    // Create backup
    const backupPath = path.join(
      CLONED_SITES_DIR,
      siteId,
      `backup_${Date.now()}.html`
    );
    try {
      const originalHtml = await fs.readFile(htmlPath, "utf8");
      await fs.writeFile(backupPath, originalHtml);
    } catch (backupError) {
      console.warn("Could not create backup:", backupError);
    }

    // Save the updated HTML
    await fs.writeFile(htmlPath, $.html());

    // Update metadata
    await updateSiteMetadata(siteId);

    res.json({
      success: true,
      message: `Element ${action} completed successfully`,
      selector: selector,
    });
  } catch (error) {
    console.error("Element update error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update element: " + error.message,
    });
  }
});

// Delete a cloned site
router.delete("/api/sites/:siteId", async (req, res) => {
  const { siteId } = req.params;

  try {
    const sitePath = path.join(CLONED_SITES_DIR, siteId);

    // Check if site exists
    try {
      await fs.access(sitePath);
    } catch (error) {
      return res.status(404).json({ success: false, error: "Site not found" });
    }

    // Delete the site directory recursively
    const deleteFolderRecursive = async (folderPath) => {
      const files = await fs.readdir(folderPath);

      for (const file of files) {
        const curPath = path.join(folderPath, file);
        const stats = await fs.stat(curPath);

        if (stats.isDirectory()) {
          // Recursive delete for directories
          await deleteFolderRecursive(curPath);
        } else {
          // Delete file
          await fs.unlink(curPath);
        }
      }

      // Delete the empty directory
      await fs.rmdir(folderPath);
    };

    await deleteFolderRecursive(sitePath);

    res.json({ success: true, message: `Site ${siteId} deleted successfully` });
  } catch (error) {
    console.error("Error deleting site:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Apply font to entire website
router.post("/api/sites/:siteId/font", async (req, res) => {
  const { siteId } = req.params;
  const { fontFamily } = req.body;

  try {
    if (!fontFamily) {
      return res
        .status(400)
        .json({ success: false, error: "Font family is required" });
    }

    const htmlPath = path.join(CLONED_SITES_DIR, siteId, "index.html");
    const html = await fs.readFile(htmlPath, "utf8");
    const $ = cheerio.load(html);

    // Create or update a style tag for global font
    let fontStyleTag = $("#website-font-style");
    if (fontStyleTag.length === 0) {
      // Create new style tag
      $("head").append('<style id="website-font-style"></style>');
      fontStyleTag = $("#website-font-style");
    }

    // Set the global font style
    const fontCSS = `body, * { font-family: ${fontFamily} !important; }`;
    fontStyleTag.html(fontCSS);

    // Create backup
    const backupPath = path.join(
      CLONED_SITES_DIR,
      siteId,
      `backup_${Date.now()}.html`
    );
    try {
      const originalHtml = await fs.readFile(htmlPath, "utf8");
      await fs.writeFile(backupPath, originalHtml);
    } catch (backupError) {
      console.warn("Could not create backup:", backupError);
    }

    // Save the updated HTML
    await fs.writeFile(htmlPath, $.html());

    // Update metadata
    await updateSiteMetadata(siteId);

    res.json({
      success: true,
      message: "Font applied successfully",
      fontFamily: fontFamily,
    });
  } catch (error) {
    console.error("Font application error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to apply font: " + error.message,
    });
  }
});

// Replace image
router.post(
  "/api/sites/:siteId/image/replace",
  upload.single("image"),
  async (req, res) => {
    const { siteId } = req.params;
    const { selector, elementId, position } = req.body;

    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, error: "No image file provided" });
      }

      console.log(
        `Image replacement request - Selector: "${selector}", ElementId: "${elementId}"`
      );

      const htmlPath = path.join(CLONED_SITES_DIR, siteId, "index.html");
      const html = await fs.readFile(htmlPath, "utf8");
      const $ = cheerio.load(html);

      // Find element by unique data attribute first, then fallback to selector
      let elements = elementId
        ? $(`[data-editor-element-id="${elementId}"]`)
        : $();

      if (elements.length === 0) {
        elements = $(selector);
      }

      if (elements.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Image element not found: ${selector}`,
        });
      }

      // Find the exact element if multiple matches
      let element = elements.first();
      if (elements.length > 1 && position) {
        const parsedPosition =
          typeof position === "string" ? JSON.parse(position) : position;

        for (let i = 0; i < elements.length; i++) {
          const candidateElement = elements.eq(i);
          const candidateParent = candidateElement.parent();
          const candidateSiblingIndex = candidateParent
            .children()
            .index(candidateElement[0]);

          if (candidateSiblingIndex === parsedPosition.siblingIndex) {
            element = candidateElement;
            break;
          }
        }
      }

      // Verify this is an image element
      if (element.prop("tagName").toLowerCase() !== "img") {
        return res.status(400).json({
          success: false,
          error: "Selected element is not an image",
        });
      }

      // Generate the new image path
      const newImagePath = `./assets/${req.file.filename}`;

      // Update the src attribute
      element.attr("src", newImagePath);

      // Create backup
      const backupPath = path.join(
        CLONED_SITES_DIR,
        siteId,
        `backup_${Date.now()}.html`
      );
      try {
        const originalHtml = await fs.readFile(htmlPath, "utf8");
        await fs.writeFile(backupPath, originalHtml);
      } catch (backupError) {
        console.warn("Could not create backup:", backupError);
      }

      // Save the updated HTML
      await fs.writeFile(htmlPath, $.html());

      // Update metadata
      await updateSiteMetadata(siteId);

      res.json({
        success: true,
        message: "Image replaced successfully",
        imagePath: newImagePath,
        filename: req.file.filename,
      });
    } catch (error) {
      console.error("Image replacement error:", error);

      // Clean up uploaded file if there was an error
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          console.warn("Could not delete uploaded file:", unlinkError);
        }
      }

      res.status(500).json({
        success: false,
        error: "Failed to replace image: " + error.message,
      });
    }
  }
);

module.exports = router;
