const functions = require('@google-cloud/functions-framework');
const { PubSub } = require('@google-cloud/pubsub');
const { Firestore } = require('@google-cloud/firestore');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const PROJECT_ID = process.env.PROJECT_ID;
const PIXEL_EVENTS_TOPIC = process.env.PIXEL_EVENTS_TOPIC;
const JWT_SECRET = process.env.JWT_SECRET;

const pubsub = new PubSub({ projectId: PROJECT_ID });
const firestore = new Firestore({ projectId: PROJECT_ID, databaseId: 'team11-database' });

// Here we create middleware to parse cookies.
const parseCookies = cookieParser();


//Here we verify JWT from Authorization header or cookies.
function verifyToken(req) {
  let token = null;

  // Check X-Forwarded-Authorization (API Gateway forwards Authorization header here)
  const authHeader = req.headers['x-forwarded-authorization'] || req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // Fallback to cookies
  if (!token) {
    token = req.cookies?.jwt;
  }

  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return null;
  }
}


//Handle GET /api/pixels - Get all pixels

async function getPixels(req, res) {
  try {
    const query = firestore.collection('pixels');

    const snapshot = await query.limit(10000).get();

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


//Handle GET /api/canvas

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


//Handle POST /api/pixels

async function placePixel(req, res, user) {
  try {
    const { x, y, color } = req.body;

    if (typeof x !== 'number' || typeof y !== 'number' || typeof color !== 'string') {
      return res.status(400).json({ error: 'Invalid pixel data' });
    }

    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Invalid color format. Use #RRGGBB' });
    }

    // Here we check rate limit before publishing.
    const rateLimitWindow = 60; // seconds
    const rateLimitMax = 20; // pixels per window
    const now = Math.floor(Date.now() / 1000);
    const minute = Math.floor(now / rateLimitWindow);
    const docID = `${user.sub}_${minute}`;

    const rateLimitRef = firestore.collection('rate_limits').doc(docID);
    const rateLimitDoc = await rateLimitRef.get();

    if (rateLimitDoc.exists) {
      const count = rateLimitDoc.data().count || 0;
      if (count >= rateLimitMax) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `You can place ${rateLimitMax} pixels per minute`
        });
      }
    }

    // Here we respond immediately.
    res.status(202).json({
      status: 'accepted',
      message: 'Pixel placement request accepted'
    });

    // Here we publish to Pub/Sub.
    const messageData = {
      x,
      y,
      color: color.replace(/^#/, '').toUpperCase(), // Strip # and uppercase (match discord-proxy format)
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

    console.log(`Pixel placement published: (${x}, ${y})`);

  } catch (error) {
    console.error('Error placing pixel:', error);
  }
}


//Main HTTP handler

functions.http('handler', async (req, res) => {
  // Here we enable CORS with credentials.
  res.set('Access-Control-Allow-Origin', process.env.FRONTEND_URL);
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  // Here we parse cookies before authentication.
  parseCookies(req, res, async () => {

    const path = req.path || '/';

    // Public GET routes.
    if (req.method === 'GET') {
      if (path.startsWith('/api/pixels')) {
        return await getPixels(req, res);
      }
      if (path.startsWith('/api/canvas')) {
        return await getCanvas(req, res);
      }
      return res.status(404).json({ error: 'Not found' });
    }

    // Protected POST routes.
    if (req.method === 'POST') {
      const user = verifyToken(req);

      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (path.startsWith('/api/pixels')) {
        return await placePixel(req, res, user);
      }

      return res.status(404).json({ error: 'Not found' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  });
});