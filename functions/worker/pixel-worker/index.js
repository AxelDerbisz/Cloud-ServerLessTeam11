/**
 * Pixel Worker Function
 *
 * Pub/Sub-triggered function that:
 * 1. Validates pixel placement
 * 2. Checks rate limits
 * 3. Updates Firestore
 * 4. Sends Discord follow-up if source is Discord
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');
const { PubSub } = require('@google-cloud/pubsub');

const PROJECT_ID = process.env.PROJECT_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PUBLIC_PIXEL_TOPIC = process.env.PUBLIC_PIXEL_TOPIC || 'public-pixel';

const firestore = new Firestore({ projectId: PROJECT_ID, databaseId: 'team11-database' });
const pubsub = new PubSub({ projectId: PROJECT_ID });

const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';

// Rate limiting constants
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 20; // pixels per window

/**
 * Send follow-up message to Discord
 */
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

/**
 * Check and update rate limit
 */
async function checkRateLimit(userId) {
  const now = new Date();
  const minute = Math.floor(now.getTime() / 1000 / RATE_LIMIT_WINDOW);
  const rateLimitId = `${userId}_${minute}`;

  const rateLimitRef = firestore.collection('rate_limits').doc(rateLimitId);

  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(rateLimitRef);

      if (!doc.exists) {
        // Create new rate limit entry
        transaction.set(rateLimitRef, {
          count: 1,
          userId: userId,
          window: minute,
          expiresAt: new Date(now.getTime() + (RATE_LIMIT_WINDOW * 2 * 1000))
        });
        return { allowed: true, count: 1 };
      }

      const data = doc.data();
      if (data.count >= RATE_LIMIT_MAX) {
        return { allowed: false, count: data.count };
      }

      // Increment count
      transaction.update(rateLimitRef, {
        count: Firestore.FieldValue.increment(1)
      });

      return { allowed: true, count: data.count + 1 };
    });

    return result;
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // On error, allow the request (fail open)
    return { allowed: true, count: 0 };
  }
}

/**
 * Validate canvas bounds
 */
async function validateBounds(x, y) {
  const sessionDoc = await firestore.collection('sessions').doc('current').get();

  if (!sessionDoc.exists) {
    console.error('No active session');
    return { valid: false, reason: 'No active session' };
  }

  const session = sessionDoc.data();

  if (session.status !== 'active') {
    console.error('Session not active:', session.status);
    return { valid: false, reason: `Session is ${session.status}` };
  }

  // Check bounds if canvas has size limits
  if (session.canvasWidth && session.canvasHeight) {
    if (x < 0 || x >= session.canvasWidth || y < 0 || y >= session.canvasHeight) {
      console.error(`Pixel out of bounds: (${x}, ${y})`);
      return { valid: false, reason: `Coordinates out of bounds (0-${session.canvasWidth-1}, 0-${session.canvasHeight-1})` };
    }
  }

  // For infinite canvas, allow reasonable bounds
  const MAX_COORDINATE = 100000;
  if (Math.abs(x) > MAX_COORDINATE || Math.abs(y) > MAX_COORDINATE) {
    console.error('Pixel coordinate too large');
    return { valid: false, reason: 'Coordinates too large' };
  }

  return { valid: true };
}

/**
 * Validate color format
 */
function validateColor(color) {
  const hexRegex = /^[0-9A-Fa-f]{6}$/;
  return hexRegex.test(color);
}

/**
 * Update pixel in Firestore
 */
async function updatePixel(x, y, color, userId, username, source) {
  const pixelId = `${x}_${y}`;
  const pixelRef = firestore.collection('pixels').doc(pixelId);
  const userRef = firestore.collection('users').doc(userId);

  try {
    await firestore.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);

      // Update pixel
      transaction.set(pixelRef, {
        x: x,
        y: y,
        color: color,
        userId: userId,
        username: username,
        source: source || 'web',
        updatedAt: new Date().toISOString()
      });

      // Update user stats
      if (userDoc.exists) {
        transaction.update(userRef, {
          lastPixelAt: new Date().toISOString(),
          pixelCount: Firestore.FieldValue.increment(1)
        });
      } else {
        // Create user document if it doesn't exist
        transaction.set(userRef, {
          id: userId,
          username: username,
          lastPixelAt: new Date().toISOString(),
          pixelCount: 1,
          createdAt: new Date().toISOString()
        });
      }
    });

    console.log(`Pixel updated: (${x}, ${y}) = #${color} by ${username}`);
    return true;
  } catch (error) {
    console.error('Failed to update pixel:', error);
    return false;
  }
}

/**
 * CloudEvent function handler (Pub/Sub)
 */
functions.cloudEvent('handler', async (cloudEvent) => {
  console.log('Pixel event received');

  try {
    // Decode Pub/Sub message
    const data = cloudEvent.data.message.data;
    const messageData = JSON.parse(Buffer.from(data, 'base64').toString());

    const { x, y, color, userId, username, source, interactionToken, applicationId } = messageData;

    console.log(`Processing pixel: (${x}, ${y}) = #${color} by ${username} [source: ${source || 'web'}]`);

    // Validate color format
    if (!validateColor(color)) {
      const errorMsg = `Invalid color format: ${color}. Use 6-digit hex (e.g., FF0000)`;
      console.error(errorMsg);
      if (source === 'discord') {
        await sendDiscordFollowUp(applicationId, interactionToken, `❌ ${errorMsg}`);
      }
      return;
    }

    // Validate bounds
    const boundsCheck = await validateBounds(x, y);
    if (!boundsCheck.valid) {
      console.error('Pixel placement rejected:', boundsCheck.reason);
      if (source === 'discord') {
        await sendDiscordFollowUp(applicationId, interactionToken, `❌ ${boundsCheck.reason}`);
      }
      return;
    }

    // Check rate limit
    const rateLimit = await checkRateLimit(userId);
    if (!rateLimit.allowed) {
      const errorMsg = `Rate limit exceeded (${rateLimit.count}/${RATE_LIMIT_MAX} per minute)`;
      console.error(`${errorMsg} for user ${userId}`);
      if (source === 'discord') {
        await sendDiscordFollowUp(applicationId, interactionToken, `❌ ${errorMsg}`);
      }
      return;
    }

    console.log(`Rate limit check passed: ${rateLimit.count}/${RATE_LIMIT_MAX}`);

    // Update pixel
    const success = await updatePixel(x, y, color, userId, username, source);

    if (success) {
      console.log('Pixel placement successful');

      // Publish to public-pixel topic for real-time web client updates
      try {
        await pubsub.topic(PUBLIC_PIXEL_TOPIC).publishMessage({
          data: Buffer.from(JSON.stringify({
            x, y, color, userId, username,
            timestamp: new Date().toISOString()
          })),
          attributes: { type: 'pixel_update' }
        });
        console.log('Published to public-pixel topic');
      } catch (pubsubError) {
        console.error('Failed to publish to public-pixel:', pubsubError);
        // Don't fail the request if pubsub fails
      }

      if (source === 'discord') {
        await sendDiscordFollowUp(
          applicationId,
          interactionToken,
          `✅ Pixel placed at (${x}, ${y}) with color #${color}`
        );
      }
    } else {
      console.error('Pixel placement failed');
      if (source === 'discord') {
        await sendDiscordFollowUp(applicationId, interactionToken, '❌ Failed to place pixel');
      }
    }
  } catch (error) {
    console.error('Error processing pixel event:', error);
    throw error; // Trigger retry
  }
});
