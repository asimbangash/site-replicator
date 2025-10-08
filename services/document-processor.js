const fs = require("fs").promises;
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

// Extract text from PDF files
async function extractTextFromPDF(filePath) {
  try {
    console.log("📄 Processing PDF:", path.basename(filePath));

    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);

    const text = data.text.trim();
    console.log(`✅ Extracted ${text.length} characters from PDF`);

    return text;
  } catch (error) {
    console.error("❌ PDF extraction error:", error);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

// Extract text from Word documents
async function extractTextFromWord(filePath) {
  try {
    console.log("📝 Processing Word document:", path.basename(filePath));

    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value.trim();

    console.log(`✅ Extracted ${text.length} characters from Word document`);

    if (result.messages.length > 0) {
      console.warn("Word document warnings:", result.messages);
    }

    return text;
  } catch (error) {
    console.error("❌ Word extraction error:", error);
    throw new Error(
      `Failed to extract text from Word document: ${error.message}`
    );
  }
}

// Extract text from plain text files
async function extractTextFromTXT(filePath) {
  try {
    console.log("📃 Processing text file:", path.basename(filePath));

    const text = await fs.readFile(filePath, "utf8");

    console.log(`✅ Read ${text.length} characters from text file`);
    return text.trim();
  } catch (error) {
    console.error("❌ Text file reading error:", error);
    throw new Error(`Failed to read text file: ${error.message}`);
  }
}

// Main function to extract text from any supported document
async function extractTextFromDocument(filePath) {
  try {
    // Check if file exists
    await fs.access(filePath);

    // Get file extension
    const extension = path.extname(filePath).toLowerCase();

    console.log(
      `🔍 Processing document: ${path.basename(filePath)} (${extension})`
    );

    let text = "";

    switch (extension) {
      case ".pdf":
        text = await extractTextFromPDF(filePath);
        break;

      case ".docx":
      case ".doc":
        text = await extractTextFromWord(filePath);
        break;

      case ".txt":
        text = await extractTextFromTXT(filePath);
        break;

      default:
        throw new Error(
          `Unsupported file type: ${extension}. Supported types: .pdf, .docx, .doc, .txt`
        );
    }

    // Validate extracted text
    if (!text || text.length < 10) {
      throw new Error("Document appears to be empty or too short");
    }

    // Clean up the text
    const cleanedText = cleanExtractedText(text);

    console.log(
      `✅ Successfully processed document: ${cleanedText.length} characters`
    );

    return cleanedText;
  } catch (error) {
    console.error("❌ Document processing failed:", error);
    throw error;
  }
}

// Clean and normalize extracted text
function cleanExtractedText(text) {
  return (
    text
      // Remove excessive whitespace
      .replace(/\s+/g, " ")
      // Remove special characters that might confuse AI
      .replace(/[^\w\s\-.,!?()$%@#]/g, "")
      // Trim whitespace
      .trim()
      // Limit length (AI has token limits)
      .substring(0, 10000)
  ); // Max 10k characters
}

// Analyze document content for key information
function analyzeDocumentContent(text) {
  const analysis = {
    wordCount: text.split(/\s+/).length,
    hasProductInfo: /product|ingredient|benefit|feature/i.test(text),
    hasPricing: /\$|price|cost|dollar|USD/i.test(text),
    hasContactInfo: /email|phone|contact|address/i.test(text),
    hasCompanyInfo: /company|founded|established|about/i.test(text),
    keyTopics: extractKeyTopics(text),
  };

  console.log("📊 Document analysis:", analysis);
  return analysis;
}

// Extract key topics from document
function extractKeyTopics(text) {
  const topics = [];

  // Common business/product keywords
  const keywords = [
    "product",
    "service",
    "benefit",
    "feature",
    "ingredient",
    "price",
    "cost",
    "guarantee",
    "warranty",
    "shipping",
    "company",
    "brand",
    "mission",
    "vision",
    "founded",
    "customer",
    "client",
    "target",
    "audience",
    "market",
  ];

  keywords.forEach((keyword) => {
    const regex = new RegExp(`\\b${keyword}\\w*\\b`, "gi");
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      topics.push({
        topic: keyword,
        mentions: matches.length,
        examples: matches.slice(0, 3), // First 3 examples
      });
    }
  });

  return topics.sort((a, b) => b.mentions - a.mentions).slice(0, 5);
}

// Validate document for AI processing
function validateDocumentForAI(text) {
  const minLength = 50;
  const maxLength = 10000;

  if (text.length < minLength) {
    throw new Error(
      `Document too short (${text.length} chars). Minimum ${minLength} characters required.`
    );
  }

  if (text.length > maxLength) {
    console.warn(
      `Document very long (${text.length} chars). Will be truncated to ${maxLength} characters.`
    );
    return text.substring(0, maxLength);
  }

  return text;
}

// Process document and return structured data
async function processDocumentForAI(filePath) {
  try {
    console.log("🔄 Starting document processing for AI...");

    // Extract text
    const rawText = await extractTextFromDocument(filePath);

    // Validate for AI
    const validatedText = validateDocumentForAI(rawText);

    // Analyze content
    const analysis = analyzeDocumentContent(validatedText);

    const result = {
      success: true,
      text: validatedText,
      analysis: analysis,
      filename: path.basename(filePath),
      processedAt: new Date().toISOString(),
    };

    console.log("✅ Document processing complete");
    return result;
  } catch (error) {
    console.error("❌ Document processing failed:", error);

    return {
      success: false,
      error: error.message,
      filename: path.basename(filePath),
      processedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  extractTextFromDocument,
  processDocumentForAI,
  analyzeDocumentContent,
  validateDocumentForAI,
  cleanExtractedText,
};
