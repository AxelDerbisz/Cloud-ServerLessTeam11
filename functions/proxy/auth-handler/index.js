/**
 * Auth Handler Function
 *
 * HTTP-triggered function that handles Discord OAuth2 flow:
 * 1. GET /auth/login - Redirects to Discord OAuth2
 * 2. GET /auth/callback - Handles OAuth2 callback, issues JWT
 * 3. GET /auth/me - Returns current user info from JWT
 */

// Initialize tracing before other imports
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { TraceExporter } = require('@google-cloud/opentelemetry-cloud-trace-exporter');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { trace, SpanStatusCode } = require('@opentelemetry/api');

const tracerProvider = new NodeTracerProvider({
  resource: new Resource({ [ATTR_SERVICE_NAME]: 'auth-handler' }),
});
tracerProvider.addSpanProcessor(new SimpleSpanProcessor(new TraceExporter({ projectId: process.env.PROJECT_ID })));
tracerProvider.register();

const tracer = trace.getTracer('auth-handler');

function logJson(severity, message, fields = {}) {
  console.log(JSON.stringify({ severity, message, ...fields }));
}

const functions = require('@google-cloud/functions-framework');
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const PROJECT_ID = process.env.PROJECT_ID;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

const firestore = new Firestore({ projectId: PROJECT_ID, databaseId: 'team11-database' });

const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';


function getRedirectUri(req) {
  if (process.env.REDIRECT_URI) {
    return process.env.REDIRECT_URI;
  }
  // Fallback: construct from request headers
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${protocol}://${host}/auth/callback`;
}

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

  // In production, you'd want to store state in session/cookie to validate
  res.redirect(authUrl);
}

/**
 * Handle GET /auth/callback - OAuth2 callback
 */
async function handleCallback(req, res) {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const redirectUri = getRedirectUri(req);

    // Exchange code for access token
    const tokenResponse = await fetch(`${DISCORD_API_ENDPOINT}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get user info from Discord
    const userResponse = await fetch(`${DISCORD_API_ENDPOINT}/users/@me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userResponse.ok) {
      throw new Error('Failed to get user info');
    }

    const userData = await userResponse.json();

    // Store/update user in Firestore
    await firestore.collection('users').doc(userData.id).set({
      username: userData.username,
      discriminator: userData.discriminator,
      avatar: userData.avatar,
      lastLogin: new Date().toISOString(),
      pixelCount: FieldValue.increment(0) // Initialize if new
    }, { merge: true });

    // Create JWT
    const jwtToken = jwt.sign(
      {
        sub: userData.id,
        username: userData.username,
        discriminator: userData.discriminator,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
      },
      JWT_SECRET
    );

    // Return JWT to client
    // In production, you'd redirect to frontend with token
    logJson('INFO', 'auth_callback_success', { user_id: userData.id, username: userData.username });
    res.status(200).json({
      token: jwtToken,
      user: {
        id: userData.id,
        username: userData.username,
        discriminator: userData.discriminator,
        avatar: userData.avatar
      }
    });
  } catch (error) {
    logJson('ERROR', 'auth_callback_failed', { error: error.message });
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Handle GET /auth/me - Get current user
 */
async function handleMe(req, res) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Optionally fetch updated user data from Firestore
    const userDoc = await firestore.collection('users').doc(decoded.sub).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();

    res.status(200).json({
      id: decoded.sub,
      username: decoded.username,
      discriminator: decoded.discriminator,
      pixelCount: userData.pixelCount || 0,
      lastPixelAt: userData.lastPixelAt || null
    });
  } catch (error) {
    logJson('WARNING', 'auth_me_invalid_token');
    res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * HTTP function handler
 */
functions.http('handler', async (req, res) => {
  const span = tracer.startSpan('auth-handler');

  try {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') {
      span.setAttribute('auth.operation', 'cors_preflight');
      span.setStatus({ code: SpanStatusCode.OK });
      return res.status(204).send('');
    }

    if (req.method !== 'GET') {
      span.setAttribute('auth.operation', 'method_not_allowed');
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Method not allowed' });
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const path = req.path || '/';
    span.setAttribute('http.path', path);

    if (path.startsWith('/auth/login') || path.includes('login')) {
      span.setAttribute('auth.operation', 'login');
      span.updateName('auth.login');
      const result = handleLogin(req, res);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    }

    if (path.startsWith('/auth/callback') || path.includes('callback')) {
      span.setAttribute('auth.operation', 'callback');
      span.updateName('auth.callback');
      const result = await handleCallback(req, res);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    }

    if (path.startsWith('/auth/me') || path.includes('/me')) {
      span.setAttribute('auth.operation', 'me');
      span.updateName('auth.me');
      const result = await handleMe(req, res);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    }

    span.setAttribute('auth.operation', 'not_found');
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Not found' });
    res.status(404).json({ error: 'Not found' });
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    span.end();
    // Flush traces before function exits (required for serverless)
    try {
      await tracerProvider.forceFlush();
    } catch (flushError) {
      // flush failed silently
    }
  }
});
