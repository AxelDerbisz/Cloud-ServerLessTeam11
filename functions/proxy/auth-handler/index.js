const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { TraceExporter } = require('@google-cloud/opentelemetry-cloud-trace-exporter');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { trace, SpanStatusCode } = require('@opentelemetry/api');

const tracerProvider = new NodeTracerProvider({
  resource: new Resource({ [ATTR_SERVICE_NAME]: 'auth-handler' }),
});
tracerProvider.addSpanProcessor(
  new SimpleSpanProcessor(new TraceExporter({ projectId: process.env.PROJECT_ID }))
);
tracerProvider.register();

const tracer = trace.getTracer('auth-handler');

function logJson(severity, message, fields = {}) {
  console.log(JSON.stringify({ severity, message, ...fields }));
}

const functions = require('@google-cloud/functions-framework');
const cookieParser = require("cookie-parser");
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { PubSub } = require('@google-cloud/pubsub');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const PROJECT_ID = process.env.PROJECT_ID;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

const firestore = new Firestore({
  projectId: PROJECT_ID,
  databaseId: 'team11-database'
});

const PIXEL_EVENTS_TOPIC = process.env.PIXEL_EVENTS_TOPIC;
const pubsub = new PubSub({ projectId: PROJECT_ID });

const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';


// JWT verification using cookies
function verifyToken(req) {
  try {
    const token = req.cookies?.jwt;
    if (!token) return null;
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}


// Redirect URI
function getRedirectUri(req) {
  if (process.env.REDIRECT_URI) {
    return process.env.REDIRECT_URI;
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${protocol}://${host}/auth/callback`;
}


// Login
function handleLogin(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = getRedirectUri(req);

  logJson('INFO', 'auth_login_redirect', { redirect_uri: redirectUri });

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state: state
  });

  const authUrl = `https://discord.com/api/oauth2/authorize?${params.toString()}`;

  res.redirect(authUrl);
}


// Callback
async function handleCallback(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const redirectUri = getRedirectUri(req);

    const tokenResponse = await fetch(`${DISCORD_API_ENDPOINT}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code');
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch(`${DISCORD_API_ENDPOINT}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!userResponse.ok) {
      throw new Error('Failed to get user info');
    }

    const userData = await userResponse.json();

    // Save user
    await firestore.collection('users').doc(userData.id).set({
      username: userData.username,
      discriminator: userData.discriminator,
      avatar: userData.avatar,
      lastLogin: new Date().toISOString(),
      pixelCount: FieldValue.increment(0)
    }, { merge: true });

    // Create JWT
    const jwtToken = jwt.sign(
      {
        sub: userData.id,
        username: userData.username,
        discriminator: userData.discriminator,
        exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
      },
      JWT_SECRET
    );

    // Redirect to frontend with token in URL
    res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${encodeURIComponent(jwtToken)}`);

  } catch (error) {
    logJson('ERROR', 'auth_callback_failed', { error: error.message });
    res.status(500).json({ error: 'Authentication failed' });
  }
}


// Extract user from Bearer token (X-Forwarded-Authorization or Authorization) or cookie
function getUserFromRequest(req) {
  let user = null;
  const authHeader = req.headers['x-forwarded-authorization'] || req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      user = jwt.verify(authHeader.substring(7), JWT_SECRET);
    } catch { user = null; }
  }
  if (!user) {
    user = verifyToken(req);
  }
  return user;
}


// GET /api/pixels
async function handleGetPixels(req, res) {
  try {
    const snapshot = await firestore.collection('pixels').limit(10000).get();
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
    res.status(200).json({ pixels, count: pixels.length });
  } catch (error) {
    logJson('ERROR', 'get_pixels_failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get pixels' });
  }
}


// POST /api/pixels
async function handlePlacePixel(req, res) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { x, y, color } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof color !== 'string') {
      return res.status(400).json({ error: 'Invalid pixel data' });
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Invalid color format. Use #RRGGBB' });
    }

    res.status(202).json({ status: 'accepted', message: 'Pixel placement request accepted' });

    const messageData = {
      x, y, color,
      userId: user.sub,
      username: user.username,
      timestamp: new Date().toISOString()
    };
    await pubsub.topic(PIXEL_EVENTS_TOPIC).publishMessage({
      data: Buffer.from(JSON.stringify(messageData)),
      attributes: { type: 'pixel_placement', user_id: user.sub }
    });
  } catch (error) {
    logJson('ERROR', 'place_pixel_failed', { error: error.message });
  }
}


// GET /api/canvas
async function handleGetCanvas(req, res) {
  try {
    const sessionDoc = await firestore.collection('sessions').doc('current').get();
    if (!sessionDoc.exists) {
      return res.status(200).json({ status: 'no_session', session: null });
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
    logJson('ERROR', 'get_canvas_failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get canvas state' });
  }
}


// GET current user
async function handleMe(req, res) {
  const user = getUserFromRequest(req);

  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userDoc = await firestore.collection('users').doc(user.sub).get();

  if (!userDoc.exists) {
    return res.status(404).json({ error: 'User not found' });
  }

  const data = userDoc.data();

  res.status(200).json({
    id: user.sub,
    username: user.username,
    discriminator: user.discriminator,
    pixelCount: data.pixelCount || 0,
    lastPixelAt: data.lastPixelAt || null
  });
}


// Main handler
functions.http('handler', async (req, res) => {
  cookieParser()(req, res, async () => {

    const span = tracer.startSpan('auth-handler');

    try {
      res.set("Access-Control-Allow-Origin", process.env.FRONTEND_URL);
      res.set("Access-Control-Allow-Credentials", "true");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

      if (req.method === 'OPTIONS') {
        return res.status(204).send('');
      }

      const path = req.path || '/';

      if (path.startsWith('/auth/login')) {
        return handleLogin(req, res);
      }

      if (path.startsWith('/auth/callback')) {
        return await handleCallback(req, res);
      }

      if (path.startsWith('/auth/me')) {
        return await handleMe(req, res);
      }

      // Pixel API routes
      if (path.startsWith('/api/pixels')) {
        if (req.method === 'GET') {
          return await handleGetPixels(req, res);
        }
        if (req.method === 'POST') {
          return await handlePlacePixel(req, res);
        }
      }

      if (path.startsWith('/api/canvas') && req.method === 'GET') {
        return await handleGetCanvas(req, res);
      }

      res.status(404).json({ error: 'Not found' });

    } catch (error) {
      span.recordException(error);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      span.end();
      await tracerProvider.forceFlush();
    }
  });
});
