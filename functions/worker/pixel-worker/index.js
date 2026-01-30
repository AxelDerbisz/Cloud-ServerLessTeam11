/**
 * Pixel Worker Function
 *
 * Pub/Sub-triggered function that:
 * 1. Validates pixel placement
 * 2. Checks rate limits
 * 3. Updates Firestore
 * 4. Handles concurrent updates with transactions
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');

const PROJECT_ID = process.env.PROJECT_ID;

const firestore = new Firestore({ projectId: PROJECT_ID });

// Rate limiting constants
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 20; // pixels per window

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
    return false;
  }

  const session = sessionDoc.data();

  if (session.status !== 'active') {
    console.error('Session not active:', session.status);
    return false;
  }

  // Check bounds if canvas has size limits
  if (session.canvasWidth && session.canvasHeight) {
    if (x < 0 || x >= session.canvasWidth || y < 0 || y >= session.canvasHeight) {
      console.error(`Pixel out of bounds: (${x}, ${y})`);
      return false;
    }
  }

  // For infinite canvas, allow reasonable bounds
  const MAX_COORDINATE = 100000;
  if (Math.abs(x) > MAX_COORDINATE || Math.abs(y) > MAX_COORDINATE) {
    console.error('Pixel coordinate too large');
    return false;
  }

  return true;
}

/**
 * Update pixel in Firestore
 */
async function updatePixel(x, y, color, userId, username) {
  const pixelId = `${x}_${y}`;
  const pixelRef = firestore.collection('pixels').doc(pixelId);
  const userRef = firestore.collection('users').doc(userId);

  try {
    await firestore.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);

      // Update pixel
      transaction.set(pixelRef, {
        color: color,
        userId: userId,
        username: username,
        updatedAt: new Date().toISOString(),
        x: x,
        y: y
      });

      // Update user stats
      if (userDoc.exists) {
        transaction.update(userRef, {
          lastPixelAt: new Date().toISOString(),
          pixelCount: Firestore.FieldValue.increment(1)
        });
      }
    });

    console.log(`Pixel updated: (${x}, ${y}) = ${color} by ${username}`);
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

    const { x, y, color, userId, username } = messageData;

    console.log(`Processing pixel: (${x}, ${y}) = ${color} by ${username}`);

    // Validate bounds
    const boundsValid = await validateBounds(x, y);
    if (!boundsValid) {
      console.error('Pixel placement rejected: invalid bounds');
      return;
    }

    // Check rate limit
    const rateLimit = await checkRateLimit(userId);
    if (!rateLimit.allowed) {
      console.error(`Rate limit exceeded for user ${userId} (${rateLimit.count}/${RATE_LIMIT_MAX})`);
      return;
    }

    console.log(`Rate limit check passed: ${rateLimit.count}/${RATE_LIMIT_MAX}`);

    // Update pixel
    const success = await updatePixel(x, y, color, userId, username);

    if (success) {
      console.log('Pixel placement successful');
    } else {
      console.error('Pixel placement failed');
    }
  } catch (error) {
    console.error('Error processing pixel event:', error);
    throw error; // Trigger retry
  }
});
