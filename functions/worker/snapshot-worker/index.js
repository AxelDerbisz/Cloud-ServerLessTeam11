/**
 * Snapshot Worker Function
 *
 * Pub/Sub-triggered function that:
 * 1. Generates a PNG image of the current canvas state
 * 2. Uploads it to Cloud Storage
 * 3. Posts it to Discord channel
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');
const { createCanvas } = require('canvas');

const PROJECT_ID = process.env.PROJECT_ID;
const SNAPSHOTS_BUCKET = process.env.SNAPSHOTS_BUCKET;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const firestore = new Firestore({ projectId: PROJECT_ID });
const storage = new Storage({ projectId: PROJECT_ID });

const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';

// Canvas rendering settings
const DEFAULT_CANVAS_SIZE = 1000;
const PIXEL_SIZE = 10; // Each pixel is 10x10 in the image

/**
 * Get all pixels from Firestore
 */
async function getAllPixels() {
  const snapshot = await firestore.collection('pixels').get();

  const pixels = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    pixels.push({
      x: data.x,
      y: data.y,
      color: data.color,
      username: data.username
    });
  });

  return pixels;
}

/**
 * Generate canvas image
 */
function generateCanvasImage(pixels, width, height) {
  const canvasWidth = width * PIXEL_SIZE;
  const canvasHeight = height * PIXEL_SIZE;

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Draw pixels
  pixels.forEach(pixel => {
    if (pixel.x >= 0 && pixel.x < width && pixel.y >= 0 && pixel.y < height) {
      ctx.fillStyle = pixel.color;
      ctx.fillRect(
        pixel.x * PIXEL_SIZE,
        pixel.y * PIXEL_SIZE,
        PIXEL_SIZE,
        PIXEL_SIZE
      );
    }
  });

  return canvas.toBuffer('image/png');
}

/**
 * Upload image to Cloud Storage
 */
async function uploadImage(imageBuffer, filename) {
  const bucket = storage.bucket(SNAPSHOTS_BUCKET);
  const file = bucket.file(filename);

  await file.save(imageBuffer, {
    metadata: {
      contentType: 'image/png',
      cacheControl: 'public, max-age=3600'
    },
    public: true
  });

  return `https://storage.googleapis.com/${SNAPSHOTS_BUCKET}/${filename}`;
}

/**
 * Post snapshot to Discord
 */
async function postToDiscord(channelId, imageUrl, pixelCount) {
  try {
    const response = await fetch(
      `${DISCORD_API_ENDPOINT}/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
        },
        body: JSON.stringify({
          embeds: [{
            title: '📸 Canvas Snapshot',
            description: `Canvas snapshot with ${pixelCount} pixels`,
            image: {
              url: imageUrl
            },
            color: 0x5865F2,
            timestamp: new Date().toISOString()
          }]
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error('Failed to post to Discord:', error);
    return false;
  }
}

/**
 * CloudEvent function handler (Pub/Sub)
 */
functions.cloudEvent('handler', async (cloudEvent) => {
  console.log('Snapshot request received');

  try {
    const data = cloudEvent.data.message.data;
    const messageData = JSON.parse(Buffer.from(data, 'base64').toString());

    const { channelId } = messageData;

    // Get session info
    const sessionDoc = await firestore.collection('sessions').doc('current').get();
    let canvasWidth = DEFAULT_CANVAS_SIZE;
    let canvasHeight = DEFAULT_CANVAS_SIZE;

    if (sessionDoc.exists) {
      const session = sessionDoc.data();
      canvasWidth = session.canvasWidth || canvasWidth;
      canvasHeight = session.canvasHeight || canvasHeight;
    }

    console.log(`Generating snapshot: ${canvasWidth}x${canvasHeight}`);

    // Get all pixels
    const pixels = await getAllPixels();
    console.log(`Retrieved ${pixels.length} pixels`);

    if (pixels.length === 0) {
      console.log('No pixels to render');
      // Still generate an empty canvas
    }

    // Generate image
    const imageBuffer = generateCanvasImage(pixels, canvasWidth, canvasHeight);
    console.log(`Image generated: ${imageBuffer.length} bytes`);

    // Upload to Cloud Storage
    const filename = `snapshot-${Date.now()}.png`;
    const imageUrl = await uploadImage(imageBuffer, filename);
    console.log(`Image uploaded: ${imageUrl}`);

    // Post to Discord if channel ID provided
    if (channelId) {
      const success = await postToDiscord(channelId, imageUrl, pixels.length);
      if (success) {
        console.log('Snapshot posted to Discord');
      }
    }

    console.log('Snapshot generation complete');
  } catch (error) {
    console.error('Error generating snapshot:', error);
    throw error; // Trigger retry
  }
});
