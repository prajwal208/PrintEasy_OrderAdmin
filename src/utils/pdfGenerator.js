import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";

const loadImageAsBase64 = (url, quality = 0.5, applyThreshold = true, format = "jpeg") =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      // Enable high-quality image rendering - disable smoothing for pixel-perfect quality
      // For maximum quality, we want to preserve exact pixels without interpolation
      ctx.imageSmoothingEnabled = false; // Disable smoothing to preserve exact pixel values
      
      // For PNG format, don't fill with white to preserve transparency
      // Only fill with white for JPEG format
      if (format !== "png") {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      
      // Draw image at exact original resolution - no scaling, no interpolation
      // This preserves every pixel exactly as in the original image
      ctx.drawImage(img, 0, 0);

      // Only apply threshold processing if requested (for product images)
      if (applyThreshold) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // THRESHOLD: Increase this if black is still showing. 
        // 50 targets anything from pure black up to dark charcoal.
        const threshold = 50; 

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // If the pixel is very dark (below threshold), make it white
          if (r < threshold && g < threshold && b < threshold) {
            data[i] = 255;     // R
            data[i + 1] = 255; // G
            data[i + 2] = 255; // B
          }
        }

        ctx.putImageData(imageData, 0, 0);
      }
      
      // Use specified format (PNG for lossless, JPEG with quality for compressed)
      if (format === "png") {
        resolve(canvas.toDataURL("image/png"));
      } else {
        resolve(canvas.toDataURL("image/jpeg", quality));
      }
    };

    img.onerror = (error) => {
      console.error("Error loading image in loadImageAsBase64:", error, "URL:", url);
      reject(new Error(`Failed to load image from ${url}`));
    };
    img.src = url;
  });

const safeLoadImage = async (url, quality = 0.5) => {
  try {
    return await loadImageAsBase64(url, quality);
  } catch {
    return null;
  }
};

// Higher quality loader for custom images (imageUrl)
// Preserves all colors including text - no threshold processing
// Uses PNG format for maximum quality (lossless) at original resolution
const safeLoadCustomImage = async (url) => {
  try {
    if (!url) {
      console.warn("No image URL provided");
      return null;
    }
    console.log("Loading custom image from URL:", url);
    // Use PNG format for maximum quality (lossless, no compression artifacts)
    // applyThreshold = false to preserve text and all image details
    // PNG doesn't use quality parameter as it's lossless
    // This preserves the original image resolution and quality
    const imageData = await loadImageAsBase64(url, 1.0, false, "png");
    console.log("Image loaded successfully, data length:", imageData ? imageData.length : 0);
    return imageData;
  } catch (error) {
    console.error("Error loading custom image:", error, "URL:", url);
    return null;
  }
};

/* ================= SIZE FORMAT ================= */
/** Encoded size codes: "46Y" → "4-6Y", "810Y" → "8-10Y" (space-separated parts supported). */
const formatSizeCodeForPdf = (code) => {
  if (!code || typeof code !== "string") return "";
  const trimmed = code.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\s+/)
    .map((part) => (part.length >= 2 ? part[0] + "-" + part.slice(1) : part))
    .join(" ");
};

/**
 * Resolve item size for PDF from either API shape:
 * - object: { label: "7–8Y", value: "7–8y", options: [...] }
 * - string: "46Y"
 */
const formatSizeForPdf = (sizeInfo, variantSize) => {
  const raw = sizeInfo ?? variantSize;
  if (raw == null || raw === "") return "N/A";

  if (typeof raw === "object") {
    const label = raw.label != null ? String(raw.label).trim() : "";
    const value = raw.value != null ? String(raw.value).trim() : "";
    if (label) return label;
    if (value) return formatSizeCodeForPdf(value) || value;
    return "N/A";
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "N/A";
    return formatSizeCodeForPdf(trimmed) || trimmed;
  }

  return "N/A";
};

/* ================= PAGE HELPERS ================= */
const getPageSize = (doc) => ({
  width: doc.internal.pageSize.getWidth(),
  height: doc.internal.pageSize.getHeight(),
});

const ensureSpace = (doc, y, neededHeight, margin = 20) => {
  const { height } = getPageSize(doc);
  if (y + neededHeight > height - margin) {
    doc.addPage();
    return margin;
  }
  return y;
};

/* ================= IMAGE DRAWERS ================= */
const addFullWidthImage = (doc, imgData, y, margin = 15) => {
  const { width } = getPageSize(doc);
  const props = doc.getImageProperties(imgData);
  
  // Get original image dimensions in pixels (full resolution)
  const originalWidthPx = props.width;
  const originalHeightPx = props.height;
  
  // Calculate display size to fit page width (in mm)
  // But we'll use the full pixel resolution as source
  const usableWidth = width - margin * 2;
  const ratio = originalWidthPx / originalHeightPx;
  const displayWidth = usableWidth;
  const displayHeight = displayWidth / ratio;

  // Auto-detect format from data URL (PNG or JPEG)
  const format = imgData.startsWith("data:image/png") ? "PNG" : "JPEG";
  
  // Use "SLOW" compression for maximum quality (best quality, larger file size)
  // For PNG images, use "SLOW" to ensure highest quality preservation
  // SLOW compression uses the best algorithm to preserve image quality
  const compression = format === "PNG" ? "SLOW" : "SLOW"; // Use SLOW for both to maximize quality
  
  // Add image with full original pixel resolution
  // The imgData (PNG) contains the full-resolution image data at originalWidthPx x originalHeightPx
  // jsPDF will embed this at full resolution - the display dimensions only affect layout
  // Using SLOW compression ensures maximum quality preservation during PDF creation
  doc.addImage(
    imgData,
    format,
    margin,
    y,
    displayWidth,
    displayHeight,
    undefined, // alias
    compression,
    0 // rotation
  );
  
  return displayHeight;
};

const addCenteredImage = (doc, imgData, y, maxWidth = 90) => {
  const { width } = getPageSize(doc);
  const props = doc.getImageProperties(imgData);
  const ratio = props.width / props.height;

  const imgWidth = maxWidth;
  const imgHeight = imgWidth / ratio;
  const x = (width - imgWidth) / 2;

  // Use JPEG compression in addImage
  doc.addImage(imgData, "JPEG", x, y, imgWidth, imgHeight, undefined, "FAST");
  return imgHeight;
};

/* ================= BARCODE (HIGH QUALITY) ================= */
// Generates a high-resolution barcode for orderId – large canvas, crisp bars, PNG output.
const createHighQualityBarcode = (orderId) => {
  // High-DPI canvas for sharp barcode (effective ~300 DPI when displayed at ~130mm)
  const scale = 4;
  const w = 400 * scale;
  const h = 200 * scale;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  JsBarcode(canvas, String(orderId), {
    format: "CODE128",
    width: 3 * scale,
    height: 100 * scale,
    displayValue: true,
    fontSize: 24 * scale,
    margin: 12 * scale,
  });

  // Optional: make white background transparent for cleaner embedding
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) {
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
};

const addBarcode = (doc, text, y) => {
  const canvas = document.createElement("canvas");

  JsBarcode(canvas, text, {
    format: "CODE128",
    width: 2,
    height: 35,
    displayValue: true,
    fontSize: 12,
  });

  const img = canvas.toDataURL("image/jpeg", 0.6);
  const { width } = getPageSize(doc);
  const w = 85;
  const h = 35;
  const x = (width - w) / 2;

  doc.addImage(img, "JPEG", x, y, w, h);
  return h;
};

/* ================= RENDER CONTENT TO CANVAS PAGE ================= */
const renderPageContentToCanvas = async (contentItems, pageWidthPx, pageHeightPx) => {
  const canvas = document.createElement("canvas");
  canvas.width = pageWidthPx;
  canvas.height = pageHeightPx;
  const ctx = canvas.getContext("2d");

  // High-quality rendering settings
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // White background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Scale factor: mm to pixels (300 DPI)
  const mmToPx = pageWidthPx / 210; // A4 width in mm is 210
  let y = 20 * mmToPx; // margin

  for (const item of contentItems) {
    // Draw header text (reduced size)
    if (item.type === "header") {
      ctx.fillStyle = "#000000";
      ctx.font = `bold ${8 * mmToPx}px Arial`; // Reduced from 12 to 8
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(item.text, pageWidthPx / 2, y);
      y += 10 * mmToPx; // Reduced spacing
    }

    // Draw image (centered for maximum quality)
    if (item.type === "image" && item.imageData) {
      const img = new Image();
      img.crossOrigin = "anonymous"; // Handle CORS
      await new Promise((resolve, reject) => {
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            console.error("Image loading timeout");
            reject(new Error("Image loading timeout"));
          }
        }, 30000); // 30 second timeout

        img.onerror = (err) => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            console.error("Error loading image in canvas:", err, "Image data:", item.imageData ? item.imageData.substring(0, 100) : "null");
            reject(err);
          }
        };
        img.onload = () => {
          try {
            clearTimeout(timeout);
            if (resolved) return;
            resolved = true;
            
            console.log("Image loaded in canvas, dimensions:", img.width, "x", img.height);
            
            // Calculate size to fit page with margins while maintaining aspect ratio
            const maxWidth = (pageWidthPx - 40 * mmToPx);
            const maxHeight = (pageHeightPx - 50 * mmToPx); // Leave space for smaller header
            const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
            const imgWidth = img.width * scale;
            const imgHeight = img.height * scale;
            const x = (pageWidthPx - imgWidth) / 2; // Center horizontally
            const yPos = 30 * mmToPx; // Start below header
            
            console.log("Drawing image at:", { x, yPos, imgWidth, imgHeight, scale });
            ctx.drawImage(img, x, yPos, imgWidth, imgHeight);
            console.log("Image drawn successfully");
            resolve();
          } catch (err) {
            if (!resolved) {
              resolved = true;
              console.error("Error drawing image:", err);
              reject(err);
            }
          }
        };
        
        console.log("Setting image source, data type:", typeof item.imageData, "Length:", item.imageData ? item.imageData.length : 0);
        img.src = item.imageData;
      });
    }

    // Draw barcode (centered, larger for better quality)
    if (item.type === "barcode" && item.barcodeData) {
      const barcodeImg = new Image();
      await new Promise((resolve) => {
        barcodeImg.onload = () => {
          // Use larger size for better quality
          const barcodeWidth = 120 * mmToPx;
          const barcodeHeight = (barcodeImg.height / barcodeImg.width) * barcodeWidth;
          const x = (pageWidthPx - barcodeWidth) / 2;
          const yPos = (pageHeightPx - barcodeHeight) / 2; // Center vertically
          ctx.drawImage(barcodeImg, x, yPos, barcodeWidth, barcodeHeight);
          resolve();
        };
        barcodeImg.src = item.barcodeData;
      });
    }

    // Draw separator
    if (item.type === "separator") {
      if (item.isOrderSeparator) {
        // Thicker line for order separator
        ctx.strokeStyle = "#C8C8C8";
        ctx.lineWidth = 2 * mmToPx;
        y += 10 * mmToPx;
      } else {
        ctx.strokeStyle = "#DCDCDC";
        ctx.lineWidth = 1;
      }
      ctx.beginPath();
      ctx.moveTo(40 * mmToPx, y);
      ctx.lineTo((pageWidthPx - 40 * mmToPx), y);
      ctx.stroke();
      y += 15 * mmToPx;
    }
  }

  return canvas.toDataURL("image/png");
};

/* ================= MAIN PDF ================= */
export const generatePDF = async (order, onProgress) => {
  // Create PDF with high quality settings
  const doc = new jsPDF({
    compress: true,
    precision: 16,
    unit: "mm",
    format: "a4",
  });

  const margin = 20;
  let y = margin;

  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];

    // Report progress
    if (onProgress) {
      onProgress(i + 1, order.items.length);
    }

    // PAGE 1: Image page (if image exists)
    const imageUrl = item.imageUrl || item.renderedImageUrl;
    console.log("Processing item", i, "imageUrl:", imageUrl);
    
    if (imageUrl) {
      if (i > 0 || y > margin) doc.addPage();
      y = margin;

      // Load custom image with transparency preserved
      console.log("Loading image for item", i);
      const customImg = await safeLoadCustomImage(imageUrl);
      console.log("Image loaded result:", customImg ? "Success" : "Failed");
      
      if (customImg) {
        try {
          // Get image dimensions for sizing
          let imgWidth = 0;
          let imgHeight = 0;
          
          // Try to get dimensions from the image data
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error("Image verification timeout"));
            }, 10000);
            
            img.onerror = (err) => {
              clearTimeout(timeout);
              console.warn("Warning: Could not verify image dimensions, using default:", err);
              // Use default dimensions if verification fails
              imgWidth = 800;
              imgHeight = 600;
              resolve();
            };
            img.onload = () => {
              clearTimeout(timeout);
              imgWidth = img.width;
              imgHeight = img.height;
              console.log("Image verified, dimensions:", imgWidth, "x", imgHeight);
              resolve();
            };
            img.src = customImg;
          });
          
          if (imgWidth === 0 || imgHeight === 0) {
            console.warn("Invalid image dimensions, using defaults");
            imgWidth = 800;
            imgHeight = 600;
          }
          
          // Calculate image size to fill PDF page (minimal margins for larger size)
          const pageWidth = getPageSize(doc).width;
          const pageHeight = getPageSize(doc).height;
          const minMargin = 5; // Minimal margin for larger image
          
          // Calculate to fill page width (with minimal margins)
          const availableWidth = pageWidth - (minMargin * 2);
          const availableHeight = pageHeight - (minMargin * 2);
          
          // Calculate scale to fit both width and height, use the larger scale to fill page
          const widthScale = availableWidth / imgWidth;
          const heightScale = availableHeight / imgHeight;
          const scale = Math.max(widthScale, heightScale); // Use max to fill page
          
          let finalWidth = imgWidth * scale;
          let finalHeight = imgHeight * scale;
          
          // Ensure it doesn't exceed page boundaries
          if (finalWidth > pageWidth) {
            finalWidth = pageWidth;
            finalHeight = (finalWidth / imgWidth) * imgHeight;
          }
          if (finalHeight > pageHeight) {
            finalHeight = pageHeight;
            finalWidth = (finalHeight / imgHeight) * imgWidth;
          }

          // Center the image on the page
          const xPos = (pageWidth - finalWidth) / 2;
          const yPos = (pageHeight - finalHeight) / 2;

          console.log("Adding image to PDF (large size):", { 
            pageWidth,
            pageHeight,
            finalWidth, 
            finalHeight,
            xPos,
            yPos,
            sourceWidth: imgWidth,
            sourceHeight: imgHeight,
            scale,
            imageDataLength: customImg.length
          });
          
          // Add image with PNG format (preserves transparency, no white background)
          doc.addImage(
            customImg,
            "PNG",
            xPos,
            yPos,
            finalWidth,
            finalHeight,
            undefined,
            "SLOW"
          );
          
          console.log("Image added to PDF successfully");
        } catch (error) {
          console.error("Error adding image to PDF:", error);
          // Try to add image anyway with default dimensions
          try {
            console.log("Attempting to add image with default dimensions");
            const pageWidth = getPageSize(doc).width;
            const defaultWidthMm = pageWidth - (margin * 2);
            const defaultHeightMm = defaultWidthMm * 0.75; // 4:3 aspect ratio
            const xPos = (pageWidth - defaultWidthMm) / 2;
            doc.addImage(
              customImg,
              "PNG",
              xPos,
              y,
              defaultWidthMm,
              defaultHeightMm,
              undefined,
              "SLOW"
            );
            console.log("Image added with default dimensions");
          } catch (fallbackError) {
            console.error("Failed to add image even with default dimensions:", fallbackError);
          }
        }
      } else {
        console.warn("No image data returned for item", i, "URL was:", imageUrl);
      }
    } else {
      console.warn("No imageUrl found for item", i);
    }

    // PAGE 2: Shirt image only (highest quality)
    doc.addPage();
    y = margin;

    const pageWidth = getPageSize(doc).width;
    const pageHeight = getPageSize(doc).height;
    const minMargin = 8;

    const shirtUrl = item.shirtImageUrl;
    if (shirtUrl) {
      const shirtImg = await safeLoadCustomImage(shirtUrl);
      if (shirtImg) {
        const props = doc.getImageProperties(shirtImg);
        const r = props.width / props.height;
        const maxW = pageWidth - minMargin * 2;
        const maxH = Math.min(130, pageHeight * 0.5);
        const shirtW = Math.min(maxW, maxH * r);
        const shirtH = shirtW / r;
        const shirtX = (pageWidth - shirtW) / 2;
        doc.addImage(shirtImg, "PNG", shirtX, y, shirtW, shirtH, undefined, "SLOW");
      }
    }

    // PAGE 3: Details + high-quality barcode (orderId)
    doc.addPage();
    y = margin;

    const sku = item.sku || item.productSku || "N/A";
    const quantity = item.quantity || item.qty || 1;
    const size = formatSizeForPdf(item.sizeInfo, item.variantSize);
    const name = item.name || "Customizable Product";

    doc.setFontSize(10);
    doc.setFont(undefined, "bold");
    doc.text(`Name: ${name}`, pageWidth / 2, y, { align: "center" });
    y += 8;

    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.text(`SKU: ${sku}`, pageWidth / 2, y, { align: "center" });
    y += 8;
    doc.text(`Qty: ${quantity}`, pageWidth / 2, y, { align: "center" });
    y += 8;
    doc.text(`Size: ${size}`, pageWidth / 2, y, { align: "center" });
    y += 12;

    const barcodeData = createHighQualityBarcode(order.orderId);
    const barcodeWidthMm = 130;
    const barcodeHeightMm = 52;
    const barcodeX = (pageWidth - barcodeWidthMm) / 2;
    doc.addImage(
      barcodeData,
      "PNG",
      barcodeX,
      y,
      barcodeWidthMm,
      barcodeHeightMm,
      undefined,
      "SLOW"
    );
  }

  doc.save(`order-${order.orderId}.pdf`);
};

/* ================= GENERATE COMBINED PDF FOR MULTIPLE ORDERS ================= */
export const generateCombinedPDF = async (orders, dateKey, onProgress) => {
  // Create PDF with high quality settings
  const doc = new jsPDF({
    compress: true,
    precision: 16,
    unit: "mm",
    format: "a4",
  });

  const margin = 20;
  let y = margin;
  let totalItems = 0;
  
  // Calculate total items for progress tracking
  orders.forEach(order => {
    totalItems += order.items.length;
  });

  let processedItems = 0;

  for (let orderIndex = 0; orderIndex < orders.length; orderIndex++) {
    const order = orders[orderIndex];

    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];
      processedItems++;

      // Report progress if callback provided
      if (onProgress) {
        onProgress(processedItems, totalItems);
      }

      // PAGE 1: Image page (if image exists)
      const imageUrl = item.imageUrl || item.renderedImageUrl;
      console.log("Processing item", i, "order", order.orderId, "imageUrl:", imageUrl);
      
      if (imageUrl) {
        if (processedItems > 1 || y > margin) doc.addPage();
        y = margin;

        console.log("Loading image for combined PDF, item", i);
        const customImg = await safeLoadCustomImage(imageUrl);
        console.log("Image loaded result:", customImg ? "Success" : "Failed");
        
        if (customImg) {
          try {
            // Get image dimensions for sizing
            let imgWidth = 0;
            let imgHeight = 0;
            
            // Try to get dimensions from the image data
            const img = new Image();
            img.crossOrigin = "anonymous";
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error("Image verification timeout"));
              }, 10000);
              
              img.onerror = (err) => {
                clearTimeout(timeout);
                console.warn("Warning: Could not verify image dimensions in combined PDF, using default:", err);
                // Use default dimensions if verification fails
                imgWidth = 800;
                imgHeight = 600;
                resolve();
              };
              img.onload = () => {
                clearTimeout(timeout);
                imgWidth = img.width;
                imgHeight = img.height;
                console.log("Image verified in combined PDF, dimensions:", imgWidth, "x", imgHeight);
                resolve();
              };
              img.src = customImg;
            });
            
            if (imgWidth === 0 || imgHeight === 0) {
              console.warn("Invalid image dimensions in combined PDF, using defaults");
              imgWidth = 800;
              imgHeight = 600;
            }
            
            // Calculate image size to fill PDF page (minimal margins for larger size)
            const pageWidth = getPageSize(doc).width;
            const pageHeight = getPageSize(doc).height;
            const minMargin = 5; // Minimal margin for larger image
            
            // Calculate to fill page width (with minimal margins)
            const availableWidth = pageWidth - (minMargin * 2);
            const availableHeight = pageHeight - (minMargin * 2);
            
            // Calculate scale to fit both width and height, use the larger scale to fill page
            const widthScale = availableWidth / imgWidth;
            const heightScale = availableHeight / imgHeight;
            const scale = Math.max(widthScale, heightScale); // Use max to fill page
            
            let finalWidth = imgWidth * scale;
            let finalHeight = imgHeight * scale;
            
            // Ensure it doesn't exceed page boundaries
            if (finalWidth > pageWidth) {
              finalWidth = pageWidth;
              finalHeight = (finalWidth / imgWidth) * imgHeight;
            }
            if (finalHeight > pageHeight) {
              finalHeight = pageHeight;
              finalWidth = (finalHeight / imgHeight) * imgWidth;
            }

            // Center the image on the page
            const xPos = (pageWidth - finalWidth) / 2;
            const yPos = (pageHeight - finalHeight) / 2;

            console.log("Adding image to combined PDF (large size):", { 
              pageWidth,
              pageHeight,
              finalWidth, 
              finalHeight,
              xPos,
              yPos,
              sourceWidth: imgWidth,
              sourceHeight: imgHeight,
              scale
            });
            
            // Add image with PNG format (preserves transparency, no white background)
            doc.addImage(
              customImg,
              "PNG",
              xPos,
              yPos,
              finalWidth,
              finalHeight,
              undefined,
              "SLOW"
            );
            
            console.log("Image added to combined PDF successfully");
          } catch (error) {
            console.error("Error adding image to combined PDF:", error);
            // Try to add image anyway with default dimensions
            try {
              console.log("Attempting to add image to combined PDF with default dimensions");
              const pageWidth = getPageSize(doc).width;
              const defaultWidthMm = pageWidth - (margin * 2);
              const defaultHeightMm = defaultWidthMm * 0.75; // 4:3 aspect ratio
              const xPos = (pageWidth - defaultWidthMm) / 2;
              doc.addImage(
                customImg,
                "PNG",
                xPos,
                y,
                defaultWidthMm,
                defaultHeightMm,
                undefined,
                "SLOW"
              );
              console.log("Image added to combined PDF with default dimensions");
            } catch (fallbackError) {
              console.error("Failed to add image to combined PDF even with default dimensions:", fallbackError);
            }
          }
        } else {
          console.warn("No image data returned for item", i, "in combined PDF, URL was:", imageUrl);
        }
      } else {
        console.warn("No imageUrl found for item", i, "in combined PDF");
      }

      // PAGE 2: Shirt image only (highest quality)
      doc.addPage();
      y = margin;

      const pageWidthP2 = getPageSize(doc).width;
      const pageHeightP2 = getPageSize(doc).height;
      const minMarginP2 = 8;

      const shirtUrl = item.shirtImageUrl;
      if (shirtUrl) {
        const shirtImg = await safeLoadCustomImage(shirtUrl);
        if (shirtImg) {
          const props = doc.getImageProperties(shirtImg);
          const r = props.width / props.height;
          const maxW = pageWidthP2 - minMarginP2 * 2;
          const maxH = Math.min(130, pageHeightP2 * 0.5);
          const shirtW = Math.min(maxW, maxH * r);
          const shirtH = shirtW / r;
          const shirtX = (pageWidthP2 - shirtW) / 2;
          doc.addImage(shirtImg, "PNG", shirtX, y, shirtW, shirtH, undefined, "SLOW");
        }
      }

      // PAGE 3: Details + high-quality barcode (orderId)
      doc.addPage();
      y = margin;

      const sku = item.sku || item.productSku || "N/A";
      const quantity = item.quantity || item.qty || 1;
      const size = formatSizeForPdf(item.sizeInfo, item.variantSize);
      const name = item.name || "Customizable Product";

      doc.setFontSize(10);
      doc.setFont(undefined, "bold");
      doc.text(`Name: ${name}`, pageWidthP2 / 2, y, { align: "center" });
      y += 8;

      doc.setFontSize(10);
      doc.setFont(undefined, "normal");
      doc.text(`SKU: ${sku}`, pageWidthP2 / 2, y, { align: "center" });
      y += 8;
      doc.text(`Qty: ${quantity}`, pageWidthP2 / 2, y, { align: "center" });
      y += 8;
      doc.text(`Size: ${size}`, pageWidthP2 / 2, y, { align: "center" });
      y += 12;

      const barcodeData = createHighQualityBarcode(order.orderId);
      const barcodeWidthMm = 130;
      const barcodeHeightMm = 52;
      const barcodeX = (pageWidthP2 - barcodeWidthMm) / 2;
      doc.addImage(
        barcodeData,
        "PNG",
        barcodeX,
        y,
        barcodeWidthMm,
        barcodeHeightMm,
        undefined,
        "SLOW"
      );
    }
  }

  // Format date for filename (replace spaces and special chars)
  const safeDateKey = dateKey.replace(/[^a-zA-Z0-9]/g, '-');
  doc.save(`orders-${safeDateKey}.pdf`);
};
