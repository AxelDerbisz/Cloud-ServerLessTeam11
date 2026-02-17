const functions = require('@google-cloud/functions-framework');
const { PubSub } = require('@google-cloud/pubsub');
const { Firestore } = require('@google-cloud/firestore');
const jwt = require('jsonwebtoken');

const PROJECT_ID = process.env.PROJECT_ID;
const PIXEL_EVENTS_TOPIC = process.env.PIXEL_EVENTS_TOPIC;
const JWT_SECRET = process.env.JWT_SECRET;

const pubsub = new PubSub({ projectId: PROJECT_ID });
const firestore = new Firestore({ projectId: PROJECT_ID });

/**
 * Verify JWT token
 */
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return null;
  }
}

/**
 * Handle GET /api/pixels - Get all pixels or pixels in a region
 */
async function getPixels(req, res) {
  try {
    const { x1, y1, x2, y2 } = req.query;

    let query = firestore.collection('pixels');

    // If bounds provided, filter (note: requires composite index)
    // For MVP, we'll return all pixels and let client filter
    // TODO: Implement efficient spatial queries

    const limit = 10000; // Max pixels to return
    const snapshot = await query.limit(limit).get();

    const pixels = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const [x, y] = doc.id.split('_');
      pixels.push({
        x: parseInt(x),
        y: parseInt(y),
        color: data.color,
        userId: data.userId,
        username: data.username,
        updatedAt: data.updatedAt
      });
    });

    res.status(200).json({
      pixels,
      count: pixels.length
    });
  } catch (error) {
    console.error('Error getting pixels:', error);
    res.status(500).json({ error: 'Failed to get pixels' });
  }
}

async function getCanvas(req, res) {
  try {
    const sessionDoc = await firestore.collection('sessions').doc('current').get();

    if (!sessionDoc.exists) {
      return res.status(200).json({
        status: 'no_session',
        session: null
      });
    }

    const session = sessionDoc.data();
    res.status(200).json({
      status: session.status,
      session: {
        startedAt: session.startedAt,
        canvasWidth: session.canvasWidth,
        canvasHeight: session.canvasHeight
      }
    });
  } catch (error) {
    console.error('Error getting canvas:', error);
    res.status(500).json({ error: 'Failed to get canvas state' });
  }
}

async function placePixel(req, res, user) {
  try {
    const { x, y, color } = req.body;

    // Validate input
    if (typeof x !== 'number' || typeof y !== 'number' || typeof color !== 'string') {
      return res.status(400).json({ error: 'Invalid pixel data' });
    }

    // Validate color format (hex color)
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Invalid color format. Use #RRGGBB' });
    }

    // Acknowledge immediately
    res.status(202).json({
      status: 'accepted',
      message: 'Pixel placement request accepted'
    });

    // Publish to Pub/Sub
    const messageData = {
      x,
      y,
      color,
      userId: user.sub,
      username: user.username,
      timestamp: new Date().toISOString()
    };

    const dataBuffer = Buffer.from(JSON.stringify(messageData));
    await pubsub.topic(PIXEL_EVENTS_TOPIC).publishMessage({
      data: dataBuffer,
      attributes: {
        type: 'pixel_placement',
        user_id: user.sub
      }
    });

    console.log(`Pixel placement published: (${x}, ${y}) by ${user.username}`);
  } catch (error) {
    console.error('Error placing pixel:', error);
    // Don't fail the request since we already responded
  }
}

/**
 * HTTP function handler
 */
functions.http('handler', async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  const path = req.path || '/';

  // GET requests don't require auth for canvas/pixels
  if (req.method === 'GET') {
    if (path.startsWith('/api/pixels') || path.includes('pixels')) {
      return await getPixels(req, res);
    }
    if (path.startsWith('/api/canvas') || path.includes('canvas')) {
      return await getCanvas(req, res);
    }
    return res.status(404).json({ error: 'Not found' });
  }

  // POST requests require authentication
  if (req.method === 'POST') {
    const user = verifyToken(req.headers.authorization);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (path.startsWith('/api/pixels') || path.includes('pixels')) {
      return await placePixel(req, res, user);
    }

    return res.status(404).json({ error: 'Not found' });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
