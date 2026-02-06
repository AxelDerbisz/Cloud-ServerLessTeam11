const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');
const { createCanvas } = require('canvas');

const PROJECT_ID = process.env.PROJECT_ID;
const SNAPSHOTS_BUCKET = process.env.SNAPSHOTS_BUCKET;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const firestore = new Firestore({ projectId: PROJECT_ID, databaseId: 'team11-database' });
const storage = new Storage({ projectId: PROJECT_ID });

const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';

// Canvas rendering settings
const DEFAULT_CANVAS_SIZE = 1000;
const BASE_PIXEL_SIZE = 10; // Base pixel size for small canvases
const TILE_SIZE = 2048; // Tile size in canvas coordinates (pixels) - larger for fewer tiles
const MAX_TILE_IMAGE_SIZE = 4096; // Max image dimension per tile (in pixels)
const THUMBNAIL_MAX_SIZE = 800; // Max thumbnail dimension for Discord
const PARALLEL_UPLOADS = 5; // Number of parallel tile uploads

// Calculate dynamic pixel size based on canvas size to avoid huge images
function getPixelSize(canvasWidth, canvasHeight) {
  const maxCanvasDim = Math.max(canvasWidth, canvasHeight);
  const maxTileImageSize = TILE_SIZE * BASE_PIXEL_SIZE;

  if (maxTileImageSize <= MAX_TILE_IMAGE_SIZE) {
    return BASE_PIXEL_SIZE;
  }

  // Scale down pixel size for large canvases
  return Math.max(1, Math.floor(MAX_TILE_IMAGE_SIZE / TILE_SIZE));
}

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

function generateTile(pixels, tileX, tileY, tileSize, canvasWidth, canvasHeight, pixelSize) {
  // Calculate pixel boundaries for this tile
  const startX = tileX * tileSize;
  const startY = tileY * tileSize;
  const endX = Math.min(startX + tileSize, canvasWidth);
  const endY = Math.min(startY + tileSize, canvasHeight);

  const tileWidth = (endX - startX) * pixelSize;
  const tileHeight = (endY - startY) * pixelSize;

  const canvas = createCanvas(tileWidth, tileHeight);
  const ctx = canvas.getContext('2d');

  // Fill background with light gray for grid effect
  ctx.fillStyle = '#E8E8E8';
  ctx.fillRect(0, 0, tileWidth, tileHeight);

  // Draw pixels with grid spacing (leave 1px gap for grid lines)
  const gridWidth = Math.max(1, Math.floor(pixelSize * 0.1)); // 10% of pixel size for grid, min 1px
  const pixelDrawSize = pixelSize - gridWidth;

  pixels.forEach(pixel => {
    if (pixel.x >= startX && pixel.x < endX && pixel.y >= startY && pixel.y < endY) {
      const localX = (pixel.x - startX) * pixelSize;
      const localY = (pixel.y - startY) * pixelSize;
      ctx.fillStyle = pixel.color.startsWith('#') ? pixel.color : `#${pixel.color}`;
      // Draw pixel with slight inset to show grid
      ctx.fillRect(localX, localY, pixelDrawSize, pixelDrawSize);
    }
  });

  return canvas.toBuffer('image/png');
}

function generateThumbnail(pixels, canvasWidth, canvasHeight, maxSize) {
  // Calculate thumbnail dimensions maintaining aspect ratio
  const scale = Math.min(maxSize / canvasWidth, maxSize / canvasHeight, 1);
  const thumbWidth = Math.floor(canvasWidth * scale);
  const thumbHeight = Math.floor(canvasHeight * scale);
  const pixelScale = scale; // How many canvas pixels per thumbnail pixel

  const canvas = createCanvas(thumbWidth, thumbHeight);
  const ctx = canvas.getContext('2d');

  // Fill background with light gray for grid effect
  ctx.fillStyle = '#E8E8E8';
  ctx.fillRect(0, 0, thumbWidth, thumbHeight);

  // Draw downscaled pixels with grid effect
  pixels.forEach(pixel => {
    if (pixel.x >= 0 && pixel.x < canvasWidth && pixel.y >= 0 && pixel.y < canvasHeight) {
      const thumbX = Math.floor(pixel.x * pixelScale);
      const thumbY = Math.floor(pixel.y * pixelScale);
      const size = Math.max(1, Math.floor(pixelScale)); // At least 1 pixel

      // For thumbnails, only show grid if pixels are large enough
      const gridSize = size > 2 ? 1 : 0;
      const drawSize = Math.max(1, size - gridSize);

      ctx.fillStyle = pixel.color.startsWith('#') ? pixel.color : `#${pixel.color}`;
      ctx.fillRect(thumbX, thumbY, drawSize, drawSize);
    }
  });

  return canvas.toBuffer('image/png');
}

async function uploadFile(buffer, filepath, contentType = 'image/png') {
  const bucket = storage.bucket(SNAPSHOTS_BUCKET);
  const file = bucket.file(filepath);

  await file.save(buffer, {
    metadata: {
      contentType,
      cacheControl: 'public, max-age=3600'
    }
  });

  // Bucket has uniform bucket-level access - files are publicly readable by default
  return `https://storage.googleapis.com/${SNAPSHOTS_BUCKET}/${filepath}`;
}

async function generateChunkedSnapshot(pixels, canvasWidth, canvasHeight, timestamp) {
  const tilesX = Math.ceil(canvasWidth / TILE_SIZE);
  const tilesY = Math.ceil(canvasHeight / TILE_SIZE);
  const totalTiles = tilesX * tilesY;
  const pixelSize = getPixelSize(canvasWidth, canvasHeight);

  console.log(`Generating ${tilesX}x${tilesY} = ${totalTiles} tiles (pixelSize=${pixelSize})`);

  const snapshotDir = `snapshots/${timestamp}`;

  // Create array of all tile coordinates
  const tileCoords = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      tileCoords.push({ tx, ty });
    }
  }

  // Generate all tiles first (CPU-bound, must be sequential)
  console.log('Step 1: Generating tiles...');
  const tilesToUpload = [];
  for (let i = 0; i < tileCoords.length; i++) {
    const { tx, ty } = tileCoords[i];
    const tileBuffer = generateTile(pixels, tx, ty, TILE_SIZE, canvasWidth, canvasHeight, pixelSize);
    tilesToUpload.push({ tx, ty, buffer: tileBuffer });
    if ((i + 1) % 5 === 0 || i === tileCoords.length - 1) {
      console.log(`Generated ${i + 1}/${totalTiles} tiles`);
    }
  }

  // Upload tiles in parallel batches (I/O-bound, benefits from parallelism)
  console.log('Step 2: Uploading tiles in parallel...');
  const tileUrls = [];
  for (let i = 0; i < tilesToUpload.length; i += PARALLEL_UPLOADS) {
    const batch = tilesToUpload.slice(i, i + PARALLEL_UPLOADS);

    const batchResults = await Promise.all(
      batch.map(async ({ tx, ty, buffer }) => {
        const filepath = `${snapshotDir}/tile-${tx}-${ty}.png`;
        const url = await uploadFile(buffer, filepath);
        return { x: tx, y: ty, url };
      })
    );

    tileUrls.push(...batchResults);
    console.log(`Uploaded ${tileUrls.length}/${totalTiles} tiles`);
  }

  // Generate thumbnail
  const thumbnailBuffer = generateThumbnail(pixels, canvasWidth, canvasHeight, THUMBNAIL_MAX_SIZE);
  const thumbnailUrl = await uploadFile(thumbnailBuffer, `${snapshotDir}/thumbnail.png`);

  // Create manifest
  const manifest = {
    timestamp,
    canvasWidth,
    canvasHeight,
    tileSize: TILE_SIZE,
    pixelSize: pixelSize,
    tilesX,
    tilesY,
    tiles: tileUrls,
    thumbnailUrl,
    pixelCount: pixels.length
  };

  const manifestUrl = await uploadFile(
    Buffer.from(JSON.stringify(manifest, null, 2)),
    `${snapshotDir}/manifest.json`,
    'application/json'
  );

  return { manifest, thumbnailUrl, manifestUrl };
}

async function postToDiscord(channelId, thumbnailUrl, manifestUrl, manifest) {
  try {
    const { canvasWidth, canvasHeight, pixelCount, tilesX, tilesY } = manifest;

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
            description: `**Canvas:** ${canvasWidth}x${canvasHeight} pixels\n**Pixels drawn:** ${pixelCount}\n**Tiles:** ${tilesX}x${tilesY}\n\n[View Full Resolution Tiles](${manifestUrl})`,
            image: {
              url: thumbnailUrl
            },
            color: 0x5865F2,
            timestamp: new Date().toISOString(),
            footer: {
              text: `Tile size: ${TILE_SIZE}px | Chunked for optimal web performance`
            }
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

async function sendDiscordFollowUp(applicationId, token, content) {
  if (!applicationId || !token || !DISCORD_BOT_TOKEN) {
    console.log('Discord follow-up skipped: missing credentials');
    return false;
  }

  try {
    const response = await fetch(
      `${DISCORD_API_ENDPOINT}/webhooks/${applicationId}/${token}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
        },
        body: JSON.stringify({ content })
      }
    );

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error('Failed to send Discord follow-up:', error);
    return false;
  }
}

functions.cloudEvent('handler', async (cloudEvent) => {
  console.log('Snapshot request received');

  try {
    const data = cloudEvent.data.message.data;
    const messageData = JSON.parse(Buffer.from(data, 'base64').toString());

    const { channelId, interactionToken, applicationId } = messageData;

    // Get session info
    const sessionDoc = await firestore.collection('sessions').doc('current').get();
    let canvasWidth = DEFAULT_CANVAS_SIZE;
    let canvasHeight = DEFAULT_CANVAS_SIZE;

    if (sessionDoc.exists) {
      const session = sessionDoc.data();
      canvasWidth = session.canvasWidth || canvasWidth;
      canvasHeight = session.canvasHeight || canvasHeight;
    }

    console.log(`Generating chunked snapshot: ${canvasWidth}x${canvasHeight}`);

    // Get all pixels
    const pixels = await getAllPixels();
    console.log(`Retrieved ${pixels.length} pixels`);

    // Generate chunked snapshot
    const timestamp = Date.now();
    const { manifest, thumbnailUrl, manifestUrl } = await generateChunkedSnapshot(
      pixels,
      canvasWidth,
      canvasHeight,
      timestamp
    );

    console.log(`Snapshot generated: ${manifest.tilesX * manifest.tilesY} tiles`);

    // Post to Discord if channel ID provided
    if (channelId) {
      const success = await postToDiscord(channelId, thumbnailUrl, manifestUrl, manifest);
      if (success) {
        console.log('Snapshot posted to Discord');
      }
    }

    // Send follow-up to complete the interaction
    if (interactionToken && applicationId) {
      await sendDiscordFollowUp(
        applicationId,
        interactionToken,
        `✅ Snapshot generated: ${manifest.tilesX}x${manifest.tilesY} tiles (${pixels.length} pixels)\n📊 Manifest: ${manifestUrl}`
      );
    }

    console.log('Snapshot generation complete');
  } catch (error) {
    console.error('Error generating snapshot:', error);
    // Send error follow-up if possible
    try {
      const data = cloudEvent.data.message.data;
      const messageData = JSON.parse(Buffer.from(data, 'base64').toString());
      if (messageData.interactionToken && messageData.applicationId) {
        await sendDiscordFollowUp(
          messageData.applicationId,
          messageData.interactionToken,
          `❌ Failed to generate snapshot: ${error.message}`
        );
      }
    } catch (e) {
      console.error('Failed to send error follow-up:', e);
    }
    throw error; // Trigger retry
  }
});
