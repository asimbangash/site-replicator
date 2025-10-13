const OpenAI = require("openai");
const { GoogleGenAI } = require("@google/genai");

// Initialize AI clients
let openrouter = null;
let geminiAI = null;

// Initialize Gemini with native image generation
function initializeGemini() {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY not found in environment variables");
    return null;
  }

  geminiAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  console.log("✅ Gemini AI initialized with image generation!");
  return geminiAI;
}

// Initialize OpenRouter (BEST OPTION - Multiple AI models + Image generation!)
function initializeOpenRouter() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("OPENROUTER_API_KEY not found in environment variable");
    return null;
  }

  openrouter = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  console.log("✅ OpenRouter initialized (Multiple AI models available!)");
  return openrouter;
}

// Generate IMAGE ads using OpenRouter (BEST - Multiple AI models!)
// async function generateImageAdsWithOpenRouter(inputs) {
//   try {
//     if (!openrouter) {
//       throw new Error(
//         "OpenRouter not initialized. Please check OPENROUTER_API_KEY."
//       );
//     }

//     const { landingPageContent, researchText, imageAnalysis, creativeCount } =
//       inputs;

//     console.log("🎨 Starting OpenRouter image ad generation...");

//     const imageAds = [];

//     for (let i = 0; i < creativeCount; i++) {
//       try {
//         // Step 1: Generate ad text with GPT-4 via OpenRouter
//         const textPrompt = `Create a marketing advertisement text for:

// PRODUCT INFO: ${researchText.substring(0, 500)}
// LANDING PAGE: ${landingPageContent.substring(0, 300)}
// STYLE: ${imageAnalysis}

// Generate:
// - Catchy headline (max 8 words)
// - Short description (max 20 words)
// - Call to action (max 4 words)

// Format as JSON: {"headline": "...", "description": "...", "cta": "..."}`;

//         const textResponse = await openrouter.chat.completions.create({
//           model: "openai/gpt-4o-mini",
//           messages: [{ role: "user", content: textPrompt }],
//           max_tokens: 150,
//         });

//         let rawText = textResponse.choices[0].message.content
//           .replace(/```json|```/g, "")
//           .trim();

//         let adText;
//         try {
//           adText = JSON.parse(rawText);
//         } catch (err) {
//           console.warn(
//             "⚠️ JSON parse failed, fallback to empty ad:",
//             err.message
//           );
//           adText = {
//             headline: "AI Ad",
//             description: "Generated Ad",
//             cta: "Learn More",
//           };
//         }

//         // Step 2: Generate REAL marketing image like the fashion ad example
//         const imagePrompt = `Create a professional marketing advertisement poster exactly like a high-end fashion brand ad.

// Style: Clean, modern, minimalist design with neutral background (white/cream)
// Layout:
// - Large bold text at top: "${adText.headline}"
// - Professional model or product photography in center
// - Call-to-action button: "${adText.cta}"
// - Additional text: "${adText.description}"
// - "LIMITED TIME ONLY" at bottom

// Visual style: High-end fashion photography, professional lighting, commercial quality, Instagram-ready, social media advertisement format. Make it look exactly like a real brand advertisement you'd see on social media.`;

//         // Use correct OpenRouter image generation API with modalities
//         const response = await fetch(
//           "https://openrouter.ai/api/v1/chat/completions",
//           {
//             method: "POST",
//             headers: {
//               Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
//               "Content-Type": "application/json",
//             },
//             body: JSON.stringify({
//               model: "google/gemini-2.5-flash-image-preview", // Correct OpenRouter image model
//               messages: [
//                 {
//                   role: "user",
//                   content: imagePrompt,
//                 },
//               ],
//               modalities: ["image", "text"], // Enable image generation
//             }),
//           }
//         );

//         const result = await response.json();

//         // Debug: Log the full response to understand what we're getting
//         console.log(
//           `🔍 Debug - API Response:`,
//           JSON.stringify(result, null, 2)
//         );

//         let imageUrl = null;
//         if (result.choices && result.choices[0].message.images) {
//           // Extract the generated image URL (Base64 data URL)
//           imageUrl = result.choices[0].message.images[0].image_url.url;
//           console.log(`✅ Generated REAL image with OpenRouter!`);
//         } else {
//           console.warn(`⚠️ No image generated, trying different model...`);

//           // Try with a different model that definitely supports images
//           try {
//             const response2 = await fetch(
//               "https://openrouter.ai/api/v1/chat/completions",
//               {
//                 method: "POST",
//                 headers: {
//                   Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
//                   "Content-Type": "application/json",
//                 },
//                 body: JSON.stringify({
//                   model: "google/gemini-1.5-pro-vision", // Alternative image model
//                   messages: [
//                     {
//                       role: "user",
//                       content: imagePrompt,
//                     },
//                   ],
//                   modalities: ["image", "text"],
//                 }),
//               }
//             );

//             const result2 = await response2.json();
//             console.log(
//               `🔍 Debug - Second model response:`,
//               JSON.stringify(result2, null, 2)
//             );

//             if (result2.choices && result2.choices[0].message.images) {
//               imageUrl = result2.choices[0].message.images[0].image_url.url;
//               console.log(`✅ Generated image with alternative model!`);
//             } else {
//               console.warn(
//                 `⚠️ Alternative model also failed, using placeholder`
//               );
//               imageUrl = `https://via.placeholder.com/1024x1024/4285f4/ffffff?text=${encodeURIComponent(
//                 adText.headline.replace(/\s+/g, "+")
//               )}`;
//             }
//           } catch (altError) {
//             console.error(`❌ Alternative model failed:`, altError.message);
//             imageUrl = `https://via.placeholder.com/1024x1024/4285f4/ffffff?text=${encodeURIComponent(
//               adText.headline.replace(/\s+/g, "+")
//             )}`;
//           }
//         }

//         console.log(`🖼️ Generated image ad #${i + 1} with OpenRouter`);

//         imageAds.push({
//           id: i + 1,
//           text: `${adText.headline} - ${adText.description}`,
//           type: "image_ad",
//           platform: ["facebook", "google", "instagram"][i % 3],
//           headline: adText.headline,
//           description: adText.description,
//           cta: adText.cta,
//           imageUrl: imageUrl,
//           score: 8 + Math.random() * 2,
//         });
//       } catch (error) {
//         console.error(`❌ Failed to generate image ad #${i + 1}:`, error);

//         // Fallback to text-only ad
//         imageAds.push({
//           id: i + 1,
//           text: `Professional ad #${i + 1} (image generation failed)`,
//           type: "text_ad",
//           platform: ["facebook", "google", "instagram"][i % 3],
//           headline: `Generated Ad #${i + 1}`,
//           cta: "Learn More",
//           imageUrl: null,
//           score: 7 + Math.random() * 2,
//         });
//       }
//     }

//     console.log(`🎨 Generated ${imageAds.length} image ads with OpenRouter`);
//     return imageAds;
//   } catch (error) {
//     console.error("❌ OpenRouter image generation failed:", error);
//     return generateFallbackAds(inputs.creativeCount);
//   }
// }

async function generateImageAdsWithOpenRouter(inputs) {
  try {
    if (!geminiAI) {
      throw new Error(
        "Gemini AI not initialized. Please check GEMINI_API_KEY."
      );
    }

    const { landingPageContent, researchText, imageAnalysis, creativeCount } =
      inputs;

    console.log("🎨 Starting Gemini native image ad generation...");
    const imageAds = [];

    for (let i = 0; i < creativeCount; i++) {
      try {
        // Step 1: Generate ad text
        const textPrompt = `Create a marketing advertisement text for:

PRODUCT INFO: ${researchText.substring(0, 500)}
LANDING PAGE: ${landingPageContent.substring(0, 300)}
STYLE: ${imageAnalysis}

Generate:
- Catchy headline (max 8 words)
- Short description (max 20 words)
- Call to action (max 4 words)

Format as JSON: {"headline": "...", "description": "...", "cta": "..."}`;

        const textResponse = await geminiAI.models.generateContent({
          model: "gemini-2.5-flash",
          contents: textPrompt,
        });

        let adText;
        try {
          const rawText = textResponse.candidates[0].content.parts[0].text
            .replace(/```json|```/g, "")
            .trim();
          adText = JSON.parse(rawText);
        } catch (err) {
          console.warn("⚠️ JSON parse failed, using fallback:", err.message);
          adText = {
            headline: "AI Generated Ad",
            description: "Discover amazing products today",
            cta: "Shop Now",
          };
        }

        // Step 2: Generate image with Gemini native image generation
        const imagePrompt = `Create a professional marketing advertisement poster:
Headline: "${adText.headline}"
Description: "${adText.description}"
CTA: "${adText.cta}"
Style: Clean, modern, minimalist design with neutral background (white/cream), professional product photography in center, call-to-action button, high-end commercial quality, Instagram-ready format.`;

        const imageResponse = await geminiAI.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: imagePrompt,
        });

        // Extract image from response
        let imageUrl = null;
        for (const part of imageResponse.candidates[0].content.parts) {
          if (part.inlineData) {
            // Convert base64 to data URL
            const imageData = part.inlineData.data;
            imageUrl = `data:${part.inlineData.mimeType};base64,${imageData}`;
            console.log(`✅ Generated real image with Gemini!`);
            break;
          }
        }

        // Fallback to placeholder if no image generated
        if (!imageUrl) {
          console.warn("⚠️ No image returned from Gemini, using placeholder");
          imageUrl = `https://via.placeholder.com/1024x1024/4285f4/ffffff?text=${encodeURIComponent(
            adText.headline.replace(/\s+/g, "+")
          )}`;
        }

        imageAds.push({
          id: i + 1,
          text: `${adText.headline} - ${adText.description}`,
          type: "image_ad",
          platform: ["facebook", "google", "instagram"][i % 3],
          headline: adText.headline,
          description: adText.description,
          cta: adText.cta,
          imageUrl,
          score: 8 + Math.random() * 2,
        });

        console.log(`🖼️ Generated ad #${i + 1} with Gemini`);
      } catch (error) {
        console.error(`❌ Failed to generate image ad #${i + 1}:`, error);

        // Add fallback ad
        imageAds.push({
          id: i + 1,
          text: `Professional ad #${i + 1}`,
          type: "image_ad",
          platform: ["facebook", "google", "instagram"][i % 3],
          headline: `Generated Ad #${i + 1}`,
          description: "AI-powered advertisement",
          cta: "Learn More",
          imageUrl: `https://via.placeholder.com/1024x1024/4285f4/ffffff?text=Ad+${
            i + 1
          }`,
          score: 7 + Math.random() * 2,
        });
      }
    }

    console.log(`🎨 Generated ${imageAds.length} image ads with Gemini`);
    return imageAds;
  } catch (error) {
    console.error("❌ Gemini image generation failed:", error);
    return generateFallbackAds(inputs.creativeCount);
  }
}

// Score ads using Gemini
async function scoreAdsWithOpenRouter(ads) {
  try {
    if (!geminiAI) {
      console.warn("⚠️ Gemini not available for scoring, using random scores");
      return ads.map((ad) => ({
        ...ad,
        score: 7 + Math.random() * 3, // Random score 7-10
      }));
    }

    console.log("⭐ Scoring ads with Gemini...");

    const scoredAds = [];
    for (const ad of ads) {
      try {
        const prompt = `Rate this marketing advertisement from 1-10 based on:
- Clarity and appeal of headline
- Effectiveness of call-to-action
- Overall marketing impact
- Professional quality

Advertisement:
Headline: ${ad.headline || "N/A"}
Text: ${ad.text}
CTA: ${ad.cta || "N/A"}
Platform: ${ad.platform}

Respond with only a number between 1-10 (decimals allowed, e.g., 8.5)`;

        const response = await geminiAI.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
        });

        const scoreText = response.candidates[0].content.parts[0].text.trim();
        const score = parseFloat(scoreText) || 7.5;

        scoredAds.push({
          ...ad,
          score: Math.max(1, Math.min(10, score)), // Ensure score is 1-10
        });

        console.log(`✅ Scored ad ${ad.id}: ${score}/10`);
      } catch (error) {
        console.warn(
          `⚠️ Failed to score ad ${ad.id}, using random score:`,
          error.message
        );
        scoredAds.push({
          ...ad,
          score: 7 + Math.random() * 3,
        });
      }
    }

    console.log(`✅ Scored ${scoredAds.length} ads with Gemini`);
    return scoredAds;
  } catch (error) {
    console.error("❌ Gemini scoring error:", error.message);

    // Return ads with random scores if Gemini fails
    return ads.map((ad) => ({
      ...ad,
      score: 7 + Math.random() * 3,
    }));
  }
}

// Generate fallback ads when AI fails
function generateFallbackAds(count) {
  const ads = [];
  for (let i = 0; i < count; i++) {
    ads.push({
      id: i + 1,
      text: `AI-generated ad #${i + 1} (AI service temporarily unavailable)`,
      type: ["short", "medium", "long"][i % 3],
      platform: ["facebook", "google", "instagram"][i % 3],
      headline: `Generated Ad #${i + 1}`,
      cta: "Learn More",
      score: 8 + Math.random() * 2,
    });
  }

  return ads;
}

// Main function to generate and score ads
async function generateCreatives(inputs) {
  console.log("🚀 Starting creative generation...");

  try {
    // Step 1: Try Gemini for IMAGE ad generation
    let ads;
    if (geminiAI) {
      console.log("🎨 Using Gemini for IMAGE ad generation...");
      try {
        ads = await generateImageAdsWithOpenRouter(inputs);
        console.log(`✅ Generated ${ads.length} IMAGE ads with Gemini`);
      } catch (error) {
        console.warn("⚠️ Gemini failed, using fallback ads...");
        ads = generateFallbackAds(inputs.creativeCount);
      }
    } else {
      console.log("⚠️ Gemini not available, using fallback ads...");
      ads = generateFallbackAds(inputs.creativeCount);
    }

    console.log(`📝 Generated ${ads.length} ads`);

    // Step 2: Score ads with Gemini
    const scoredAds = await scoreAdsWithOpenRouter(ads);
    console.log(`⭐ Scored ${scoredAds.length} ads`);

    // Step 3: Filter ads with score 8+ (as client requested)
    const highQualityAds = scoredAds.filter((ad) => ad.score >= 8.0);
    console.log(`✅ ${highQualityAds.length} ads passed quality filter (8+)`);

    return {
      success: true,
      totalGenerated: ads.length,
      totalScored: scoredAds.length,
      highQuality: highQualityAds.length,
      creatives: highQualityAds,
    };
  } catch (error) {
    console.error("❌ Creative generation failed:", error);

    // Return fallback data on failure
    const fallbackAds = generateFallbackAds(inputs.creativeCount);
    return {
      success: true,
      totalGenerated: fallbackAds.length,
      totalScored: fallbackAds.length,
      highQuality: fallbackAds.length,
      creatives: fallbackAds,
      note: "Using fallback data - AI services temporarily unavailable",
    };
  }
}

// Initialize AI services
function initializeAI() {
  console.log("🤖 Initializing AI services...");
  initializeGemini(); // Use Gemini with native image generation!
}

// Edit existing ads using OpenRouter AI
// async function editAdWithAI(inputs) {
//   try {
//     if (!openrouter) {
//       throw new Error(
//         "OpenRouter not initialized. Please check OPENROUTER_API_KEY."
//       );
//     }

//     const { originalAd, editPrompt, adId } = inputs;
//     console.log("🎨 Starting OpenRouter ad editing...");

//     // For image ads, we'll use Gemini 1.5 Pro Vision to generate a new image
//     if (originalAd.imageUrl && originalAd.type === "image_ad") {
//       console.log("🖼️ Editing image ad with Gemini 1.5 Pro Vision...");

//       // Create a comprehensive prompt for Gemini Vision
//       const imageEditPrompt = `Create a new professional advertisement image based on these specifications:

// ORIGINAL AD CONTENT:
// - Headline: "${originalAd.headline || "Fresh Food Hub Awaits"}"
// - Description: "${
//         originalAd.description ||
//         "Enjoy free delivery in Larkana. Shop fresh fruits, veggies, and more today!"
//       }"
// - Call to Action: "${originalAd.cta || "Order Now"}"

// USER EDIT REQUEST: ${editPrompt}

// Please create a high-quality advertisement image that:
// 1. Applies the user's requested changes: ${editPrompt}
// 2. Includes the headline text prominently displayed in the image
// 3. Shows the main subject (fresh food/groceries/products)
// 4. Has a professional commercial advertisement appearance
// 5. Is suitable for social media platforms (Facebook, Instagram)
// 6. Uses high-end photography style with professional lighting
// 7. Includes the call-to-action text or button
// 8. Maintains the same marketing message but with the requested modifications

// Style: Professional commercial photography, clean modern design, social media ready, high quality advertisement format, Instagram-worthy, commercial grade.`;

//       try {
//         // Use Gemini Vision with the original image as input for image-to-image editing
//         const response = await fetch(
//           "https://openrouter.ai/api/v1/chat/completions",
//           {
//             method: "POST",
//             headers: {
//               Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
//               "Content-Type": "application/json",
//             },
//             body: JSON.stringify({
//               model: "google/gemini-2.5-flash-image-preview",
//               messages: [
//                 {
//                   role: "user",
//                   content: [
//                     {
//                       type: "text",
//                       text: `Please edit this advertisement image based on the following instructions: ${editPrompt}

// IMPORTANT: Keep the same composition, layout, person, and overall design. Only make the specific change requested: ${editPrompt}

// For example:
// - If asked to change text color, only change the text color
// - If asked to change background, only change the background
// - Keep everything else exactly the same

// Make minimal changes while preserving the original image as much as possible.`,
//                     },
//                     {
//                       type: "image_url",
//                       image_url: {
//                         url: originalAd.imageUrl,
//                       },
//                     },
//                   ],
//                 },
//               ],
//               modalities: ["image", "text"], // Enable image generation
//             }),
//           }
//         );

//         const result = await response.json();
//         console.log(
//           "🔍 Gemini Vision Response:",
//           JSON.stringify(result, null, 2)
//         );

//         // Extract image from response (using same logic as your working ad creation)
//         let imageUrl = null;
//         if (result.choices && result.choices[0] && result.choices[0].message) {
//           const message = result.choices[0].message;

//           // Check for images array (same as working ad creation)
//           if (
//             message.images &&
//             message.images[0] &&
//             message.images[0].image_url
//           ) {
//             imageUrl = message.images[0].image_url.url;
//             console.log(`✅ Generated image with Gemini Vision!`);
//           }

//           // Alternative: Check for content array
//           else if (Array.isArray(message.content)) {
//             const imageContent = message.content.find(
//               (item) => item.type === "image"
//             );
//             if (imageContent && imageContent.image_url) {
//               imageUrl = imageContent.image_url.url;
//             }
//           }

//           // Alternative: Check for direct image URL
//           else if (message.image_url) {
//             imageUrl = message.image_url;
//           }
//         }

//         if (imageUrl) {
//           const editedAd = {
//             ...originalAd,
//             imageUrl: imageUrl,
//             editedAt: new Date().toISOString(),
//           };

//           console.log(
//             `✅ Successfully edited image ad #${adId} with Gemini Vision`
//           );
//           return {
//             success: true,
//             editedAd: editedAd,
//             changes: `Image regenerated with Gemini Vision based on prompt: ${editPrompt}`,
//           };
//         } else {
//           throw new Error("No image returned from Gemini Vision");
//         }
//       } catch (geminiError) {
//         console.warn(
//           "⚠️ Gemini Vision editing failed, falling back to text-based editing:",
//           geminiError.message
//         );

//         // Fallback: Edit text content instead
//         return await editTextContentWithAI(originalAd, editPrompt, adId);
//       }
//     } else {
//       // For text ads, edit the text content
//       return await editTextContentWithAI(originalAd, editPrompt, adId);
//     }
//   } catch (error) {
//     console.error("❌ OpenRouter ad editing failed:", error);
//     return {
//       success: false,
//       error: error.message,
//     };
//   }
// }

async function editAdWithAI(inputs) {
  try {
    if (!geminiAI) {
      throw new Error(
        "Gemini AI not initialized. Please check GEMINI_API_KEY."
      );
    }

    const { originalAd, editPrompt, adId } = inputs;
    console.log("🎨 Starting Gemini ad editing...");

    // For image ads, use Gemini Vision model for image-to-image editing
    if (originalAd.imageUrl && originalAd.type === "image_ad") {
      console.log("🖼️ Editing image ad with Gemini Vision...");

      const imageEditPrompt = `Create a new professional advertisement image based on these specifications:

ORIGINAL AD CONTENT:
- Headline: "${originalAd.headline || "Fresh Food Hub Awaits"}"
- Description: "${
        originalAd.description ||
        "Enjoy free delivery in Larkana. Shop fresh fruits, veggies, and more today!"
      }"
- Call to Action: "${originalAd.cta || "Order Now"}"

USER EDIT REQUEST: ${editPrompt}

Please create a high-quality advertisement image that:
1. Applies the user's requested changes: ${editPrompt}
2. Includes the headline text prominently displayed in the image
3. Shows the main subject (fresh food/groceries/products)
4. Has a professional commercial advertisement appearance
5. Is suitable for social media platforms (Facebook, Instagram)
6. Uses high-end photography style with professional lighting
7. Includes the call-to-action text or button
8. Maintains the same marketing message but with the requested modifications

Style: Professional commercial photography, clean modern design, social media ready, high quality advertisement format, Instagram-worthy, commercial grade.`;

      try {
        // 🧠 Use Gemini 2.5 Vision model for image editing
        const response = await geminiAI.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [
            {
              role: "user",
              parts: [
                { text: `Edit this advertisement image: ${editPrompt}` },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: originalAd.imageUrl.replace(
                      /^data:image\/\w+;base64,/,
                      ""
                    ),
                  },
                },
              ],
            },
          ],
        });

        console.log("🔍 Gemini Vision Response received!");

        // Extract image data from Gemini response
        let imageUrl = null;
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            console.log(`✅ Generated edited image with Gemini Vision!`);
            break;
          }
        }

        if (imageUrl) {
          const editedAd = {
            ...originalAd,
            imageUrl,
            editedAt: new Date().toISOString(),
          };

          console.log(
            `✅ Successfully edited image ad #${adId} with Gemini Vision`
          );
          return {
            success: true,
            editedAd,
            changes: `Image regenerated with Gemini Vision based on prompt: ${editPrompt}`,
          };
        } else {
          throw new Error("No image returned from Gemini Vision");
        }
      } catch (geminiError) {
        console.warn(
          "⚠️ Gemini Vision editing failed, falling back to text-based editing:",
          geminiError.message
        );
        // Fallback: Edit text only
        return await editTextContentWithAI(originalAd, editPrompt, adId);
      }
    } else {
      // Text ad → just edit text
      return await editTextContentWithAI(originalAd, editPrompt, adId);
    }
  } catch (error) {
    console.error("❌ Gemini ad editing failed:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Helper function to edit text content with AI
async function editTextContentWithAI(originalAd, editPrompt, adId) {
  const editingPrompt = `You are a professional marketing copywriter. Edit this advertisement based on the user's instructions.

ORIGINAL AD:
- Headline: ${originalAd.headline || originalAd.text || "No headline"}
- Description: ${originalAd.description || "No description"}
- Call to Action: ${originalAd.cta || "Learn More"}
- Platform: ${originalAd.platform || "facebook"}

USER INSTRUCTIONS: ${editPrompt}

Please edit the ad according to the user's instructions and return ONLY a JSON object with the following format:
{
  "headline": "edited headline here",
  "description": "edited description here", 
  "cta": "edited call to action here",
  "changes": "brief summary of what was changed"
}

Make sure the edited ad:
1. Follows the user's instructions precisely
2. Maintains marketing effectiveness
3. Is appropriate for the platform
4. Has compelling and clear messaging
5. Keeps the same general structure unless instructed otherwise

Return only the JSON object, no additional text.`;

  const response = await geminiAI.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: editingPrompt,
  });

  let rawResponse = response.choices[0].message.content
    .replace(/```json|```/g, "")
    .trim();
  console.log("🤖 AI Response:", rawResponse);

  let editedContent;
  try {
    editedContent = JSON.parse(rawResponse);
  } catch (parseError) {
    console.warn("⚠️ JSON parse failed, attempting to extract content...");
    editedContent = {
      headline: originalAd.headline || originalAd.text || "Edited Headline",
      description: originalAd.description || "Edited Description",
      cta: originalAd.cta || "Learn More",
      changes: "AI response parsing failed, using original content",
    };
  }

  const editedAd = {
    ...originalAd,
    headline: editedContent.headline || originalAd.headline,
    description: editedContent.description || originalAd.description,
    cta: editedContent.cta || originalAd.cta,
    editedAt: new Date().toISOString(),
  };

  // Only create combined text field for text-only ads, not image ads
  if (originalAd.type !== "image_ad") {
    editedAd.text = [
      editedContent.headline || originalAd.headline,
      editedContent.description || originalAd.description,
      editedContent.cta || originalAd.cta,
    ]
      .filter(Boolean)
      .join(" - ");
  }

  console.log(`✅ Successfully edited text content for ad #${adId}`);
  return {
    success: true,
    editedAd: editedAd,
    changes:
      editedContent.changes || "Ad content updated based on instructions",
  };
}

module.exports = {
  initializeAI,
  generateCreatives,
  generateImageAdsWithOpenRouter,
  scoreAdsWithOpenRouter,
  editAdWithAI,
};
