const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');

const router = express.Router();
const CLONED_SITES_DIR = './cloned_sites';

// Serve the editor dashboard
router.get('/editor', async (req, res) => {
    try {
        const htmlPath = path.join(__dirname, '..', 'public', 'editor.html');
        const html = await fs.readFile(htmlPath, 'utf8');
        res.send(html);
    } catch (error) {
        res.status(500).json({ error: 'Could not load editor' });
    }
});

// Get list of cloned sites for editor
router.get('/api/sites', async (req, res) => {
    try {
        const sites = await fs.readdir(CLONED_SITES_DIR);
        const sitesList = [];
        
        for (const siteId of sites) {
            if (siteId === '.DS_Store') continue;
            
            try {
                const metadataPath = path.join(CLONED_SITES_DIR, siteId, 'metadata.json');
                const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
                sitesList.push({
                    siteId,
                    originalUrl: metadata.originalUrl,
                    clonedAt: metadata.clonedAt,
                    lastEdited: metadata.lastEdited || null
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
router.get('/api/sites/:siteId/content', async (req, res) => {
    const { siteId } = req.params;
    
    try {
        const htmlPath = path.join(CLONED_SITES_DIR, siteId, 'index.html');
        const html = await fs.readFile(htmlPath, 'utf8');
        const $ = cheerio.load(html);
        
        // Extract text content and styles
        const textElements = [];
        const colorElements = [];
        
        // Find editable text elements
        $('h1, h2, h3, h4, h5, h6, p, span, a, button, div').each((i, elem) => {
            const $elem = $(elem);
            const text = $elem.text().trim();
            
            if (text.length > 0 && text.length < 500) { // Skip very long text
                const elementId = `text_${i}`;
                $elem.attr('data-editor-id', elementId);
                
                textElements.push({
                    id: elementId,
                    tag: elem.tagName.toLowerCase(),
                    text: text,
                    selector: getElementSelector($elem, i)
                });
            }
        });
        
        // Find elements with color styles - Enhanced detection
        $('*').each((i, elem) => {
            const $elem = $(elem);
            const style = $elem.attr('style') || '';
            const classes = $elem.attr('class') || '';
            const tag = elem.tagName.toLowerCase();
            
            // Skip script, style, and meta tags
            if (['script', 'style', 'meta', 'link', 'head', 'title'].includes(tag)) return;
            
            // Check for inline color styles
            const colorMatch = style.match(/(color|background-color|border-color|background)\s*:\s*([^;]+)/g);
            if (colorMatch) {
                colorMatch.forEach((match, matchIndex) => {
                    const [property, value] = match.split(':').map(s => s.trim());
                    const elementId = `color_${i}_${matchIndex}`;
                    $elem.attr('data-editor-color-id', elementId);
                    
                    colorElements.push({
                        id: elementId,
                        tag: tag,
                        property: property,
                        value: value,
                        selector: getElementSelector($elem, i),
                        classes: classes,
                        type: 'inline'
                    });
                });
            }
            
            // Detect text elements that likely have color (even without inline styles)
            if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'div', 'button', 'label'].includes(tag)) {
                const text = $elem.text().trim();
                if (text.length > 0 && text.length < 200) {
                    const elementId = `text_color_${i}`;
                    $elem.attr('data-editor-text-color-id', elementId);
                    
                    colorElements.push({
                        id: elementId,
                        tag: tag,
                        property: 'color',
                        value: 'inherit',
                        selector: getElementSelector($elem, i),
                        classes: classes,
                        type: 'text',
                        text: text.substring(0, 50) + (text.length > 50 ? '...' : '')
                    });
                }
            }
            
            // Detect buttons and clickable elements for background colors
            if (['button', 'a', 'input'].includes(tag) || classes.includes('btn') || classes.includes('button')) {
                const elementId = `bg_color_${i}`;
                $elem.attr('data-editor-bg-color-id', elementId);
                
                colorElements.push({
                    id: elementId,
                    tag: tag,
                    property: 'background-color',
                    value: 'inherit',
                    selector: getElementSelector($elem, i),
                    classes: classes,
                    type: 'background',
                    text: $elem.text().trim().substring(0, 30) || `${tag} element`
                });
            }
            
            // Detect elements with color-related classes
            if (classes) {
                const colorClasses = classes.split(' ').filter(cls => 
                    cls.includes('color') || cls.includes('bg-') || cls.includes('text-') || 
                    cls.includes('border-') || cls.match(/^(red|blue|green|yellow|purple|pink|gray|black|white|orange)/i)
                );
                
                if (colorClasses.length > 0) {
                    const elementId = `class_color_${i}`;
                    $elem.attr('data-editor-class-color-id', elementId);
                    
                    colorElements.push({
                        id: elementId,
                        tag: tag,
                        property: 'class-override',
                        value: colorClasses.join(' '),
                        selector: getElementSelector($elem, i),
                        classes: classes,
                        type: 'class',
                        text: $elem.text().trim().substring(0, 30) || `${tag} with color classes`
                    });
                }
            }
        });
        
        // IMPORTANT: Save the HTML with editor IDs back to the file
        try {
            await fs.writeFile(htmlPath, $.html());
            console.log(`Successfully saved HTML with editor IDs for site ${siteId}`);
        } catch (saveError) {
            console.error(`Failed to save HTML with editor IDs for site ${siteId}:`, saveError);
            throw saveError;
        }
        
        // Fix asset paths for preview
        let htmlPreview = $.html();
        htmlPreview = htmlPreview.replace(/src="\.\/assets\//g, `/cloned-sites/${siteId}/assets/`);
        htmlPreview = htmlPreview.replace(/href="\.\/assets\//g, `/cloned-sites/${siteId}/assets/`);
        htmlPreview = htmlPreview.replace(/url\(\.\/assets\//g, `url(/cloned-sites/${siteId}/assets/`);
        htmlPreview = htmlPreview.replace('<head>', `<head><base href="/cloned-sites/${siteId}/">`);
        htmlPreview = htmlPreview.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="frame-ancestors \'self\';">');
        
        res.json({
            textElements: textElements.slice(0, 50), // Limit for performance
            colorElements: colorElements.slice(0, 30),
            htmlPreview: htmlPreview
        });
        
    } catch (error) {
        res.status(404).json({ error: 'Site not found' });
    }
});

// Update text content
router.post('/api/sites/:siteId/text', async (req, res) => {
    const { siteId } = req.params;
    const { elementId, newText } = req.body;
    
    try {
        const htmlPath = path.join(CLONED_SITES_DIR, siteId, 'index.html');
        const html = await fs.readFile(htmlPath, 'utf8');
        const $ = cheerio.load(html);
        
        // Find and update the element
        const element = $(`[data-editor-id="${elementId}"]`);
        console.log(`Looking for element with ID: ${elementId}, found: ${element.length} elements`);
        
        if (element.length > 0) {
            console.log(`Original text: "${element.text()}", updating to: "${newText}"`);
            element.text(newText);
            
            // Save the updated HTML
            await fs.writeFile(htmlPath, $.html());
            
            // Update metadata
            await updateSiteMetadata(siteId);
            
            res.json({ success: true, message: 'Text updated successfully' });
        } else {
            // Debug: Check what data-editor-id attributes exist
            const allEditorElements = $('[data-editor-id]');
            console.log(`Available editor IDs: ${allEditorElements.map((i, el) => $(el).attr('data-editor-id')).get().join(', ')}`);
            res.status(404).json({ error: `Element not found. Available IDs: ${allEditorElements.map((i, el) => $(el).attr('data-editor-id')).get().join(', ')}` });
        }
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to update text: ' + error.message });
    }
});

// Update color styles
router.post('/api/sites/:siteId/color', async (req, res) => {
    const { siteId } = req.params;
    const { elementId, property, newColor, type } = req.body;
    
    try {
        const htmlPath = path.join(CLONED_SITES_DIR, siteId, 'index.html');
        const html = await fs.readFile(htmlPath, 'utf8');
        const $ = cheerio.load(html);
        
        let element;
        let found = false;
        
        // Find element based on type
        if (elementId.startsWith('text_color_')) {
            element = $(`[data-editor-text-color-id="${elementId}"]`);
        } else if (elementId.startsWith('bg_color_')) {
            element = $(`[data-editor-bg-color-id="${elementId}"]`);
        } else if (elementId.startsWith('class_color_')) {
            element = $(`[data-editor-class-color-id="${elementId}"]`);
        } else {
            element = $(`[data-editor-color-id="${elementId}"]`);
        }
        
        if (element.length > 0) {
            let currentStyle = element.attr('style') || '';
            
            // Handle different types of color updates
            if (type === 'class' || property === 'class-override') {
                // For class-based colors, we use CSS injection
                await injectCustomCSS(siteId, elementId, property, newColor, element);
            } else {
                // For direct style properties
                const targetProperty = type === 'text' ? 'color' : (type === 'background' ? 'background-color' : property);
                
                // Remove existing property if it exists
                currentStyle = currentStyle.replace(new RegExp(`${targetProperty}\\s*:[^;]*;?`, 'g'), '');
                
                // Add new color property with !important to override classes
                currentStyle += `${targetProperty}: ${newColor} !important;`;
                element.attr('style', currentStyle);
            }
            
            found = true;
        }
        
        if (found) {
            // Save the updated HTML
            await fs.writeFile(htmlPath, $.html());
            
            // Update metadata
            await updateSiteMetadata(siteId);
            
            res.json({ success: true, message: 'Color updated successfully' });
        } else {
            res.status(404).json({ error: 'Element not found' });
        }
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to update color: ' + error.message });
    }
});

// Helper function to inject custom CSS for class-based overrides
async function injectCustomCSS(siteId, elementId, property, newColor, element) {
    const customCSSPath = path.join(CLONED_SITES_DIR, siteId, 'custom-colors.css');
    
    let cssContent = '';
    try {
        cssContent = await fs.readFile(customCSSPath, 'utf8');
    } catch (error) {
        // File doesn't exist yet, start with empty content
    }
    
    // Generate a unique selector for this element
    const uniqueSelector = `[data-editor-class-color-id="${elementId}"]`;
    
    // Remove any existing rule for this element
    cssContent = cssContent.replace(new RegExp(`${uniqueSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*{[^}]*}`, 'g'), '');
    
    // Add new rule
    const newRule = `${uniqueSelector} { color: ${newColor} !important; background-color: ${newColor} !important; }`;
    cssContent += '\n' + newRule;
    
    // Save the custom CSS file
    await fs.writeFile(customCSSPath, cssContent);
    
    // Add CSS link to HTML if not present
    const htmlPath = path.join(CLONED_SITES_DIR, siteId, 'index.html');
    const html = await fs.readFile(htmlPath, 'utf8');
    const $ = cheerio.load(html);
    
    if (!$('link[href="./custom-colors.css"]').length) {
        $('head').append('<link rel="stylesheet" href="./custom-colors.css">');
        await fs.writeFile(htmlPath, $.html());
    }
}

// Batch save changes
router.post('/api/sites/:siteId/save', async (req, res) => {
    const { siteId } = req.params;
    const { textChanges, colorChanges } = req.body;
    
    try {
        const htmlPath = path.join(CLONED_SITES_DIR, siteId, 'index.html');
        const html = await fs.readFile(htmlPath, 'utf8');
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
                if (elementId.startsWith('text_color_')) {
                    element = $(`[data-editor-text-color-id="${elementId}"]`);
                } else if (elementId.startsWith('bg_color_')) {
                    element = $(`[data-editor-bg-color-id="${elementId}"]`);
                } else if (elementId.startsWith('class_color_')) {
                    element = $(`[data-editor-class-color-id="${elementId}"]`);
                } else {
                    element = $(`[data-editor-color-id="${elementId}"]`);
                }
                
                if (element.length > 0) {
                    if (type === 'class' || property === 'class-override') {
                        // Handle class-based colors with CSS injection
                        await injectCustomCSS(siteId, elementId, property, newColor, element);
                    } else {
                        // Handle direct style properties
                        let currentStyle = element.attr('style') || '';
                        const targetProperty = type === 'text' ? 'color' : (type === 'background' ? 'background-color' : property);
                        
                        currentStyle = currentStyle.replace(new RegExp(`${targetProperty}\\s*:[^;]*;?`, 'g'), '');
                        currentStyle += `${targetProperty}: ${newColor} !important;`;
                        element.attr('style', currentStyle);
                    }
                }
            }
        }
        
        // Create backup
        const backupPath = path.join(CLONED_SITES_DIR, siteId, `backup_${Date.now()}.html`);
        try {
            const originalHtml = await fs.readFile(htmlPath, 'utf8');
            await fs.writeFile(backupPath, originalHtml);
        } catch (backupError) {
            console.warn('Could not create backup:', backupError);
        }
        
        // Save the updated HTML
        await fs.writeFile(htmlPath, $.html());
        
        // Update metadata
        await updateSiteMetadata(siteId);
        
        res.json({ 
            success: true, 
            message: 'All changes saved successfully',
            changesApplied: {
                textChanges: textChanges?.length || 0,
                colorChanges: colorChanges?.length || 0
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to save changes: ' + error.message });
    }
});

// Helper functions
function getElementSelector($elem, index) {
    const tag = $elem.prop('tagName').toLowerCase();
    const id = $elem.attr('id');
    const classes = $elem.attr('class');
    
    if (id) return `#${id}`;
    if (classes) return `${tag}.${classes.split(' ').join('.')}`;
    return `${tag}:nth-of-type(${index + 1})`;
}

async function updateSiteMetadata(siteId) {
    try {
        const metadataPath = path.join(CLONED_SITES_DIR, siteId, 'metadata.json');
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        metadata.lastEdited = new Date().toISOString();
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
        console.warn('Could not update metadata:', error);
    }
}

module.exports = router;
