const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const port = 3001;

// Redis client
const redis = new Redis({ host: REDIS_HOST, port: 6379, retryStrategy: (times) => Math.min(times * 500, 3000) });
redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err.message));

// Connect to Identity Store Database
const pool = new Pool({
  user: 'user',
  host: 'postgres-idp',
  database: 'idpdb',
  password: 'password',
  port: 5432,
});

// Define role → permissions mapping
const ROLE_PERMISSIONS = {
  ADMIN: ['orders:read', 'orders:create', 'orders:update', 'users:read', 'users:update', 'products:read', 'products:create', 'products:update'],
  USER:  ['orders:create', 'products:read']
};

async function initDB() {
    let connected = false;
    while (!connected) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS credentials (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    user_id INTEGER NOT NULL,
                    role VARCHAR(50) DEFAULT 'USER'
                );
            `);
            const res = await pool.query('SELECT COUNT(*) FROM credentials');
            if (parseInt(res.rows[0].count) === 0) {
                await pool.query("INSERT INTO credentials (username, password, user_id, role) VALUES ('Alice', 'password123', 1, 'USER')");
                await pool.query("INSERT INTO credentials (username, password, user_id, role) VALUES ('Bob', 'password123', 2, 'ADMIN')");
                console.log("Credentials DB populated with Roles.");
            }
            connected = true;
        } catch(e) {
            console.error("DB Initialization error, retrying...", e.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}
initDB();

// LOGIN — Issue JWT + cache permissions in Redis
app.post('/oauth/token', async (req, res) => {
  const { grant_type, username, password } = req.body;

  if (grant_type !== 'password') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  try {
    const result = await pool.query('SELECT user_id, username, role FROM credentials WHERE username = $1 AND password = $2', [username, password]);
    const creds = result.rows[0];

    if (!creds) {
      return res.status(401).json({ error: 'invalid_grant' });
    }

    // Generate a unique token ID for blacklist tracking
    const crypto = require('crypto');
    const jti = crypto.randomUUID();

    // Sign Access Token with user_id, role, and jti
    const access_token = jwt.sign(
      { sub: creds.user_id, username: creds.username, role: creds.role, jti },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Cache permissions in Redis (keyed by userId, TTL = 1 hour)
    const permissions = ROLE_PERMISSIONS[creds.role] || [];
    const permData = JSON.stringify({ role: creds.role, permissions });
    await redis.setex(`permissions:${creds.user_id}`, 3600, permData);
    console.log(`Cached permissions for user ${creds.user_id}: ${permData}`);

    return res.json({
      access_token,
      token_type: 'Bearer',
      expires_in: 3600
    });
  } catch (error) {
    console.error('Database query error', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

// LOGOUT — Blacklist the JWT in Redis
app.post('/oauth/revoke', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(400).json({ error: 'missing_token' });
  }

  try {
    // Decode (without verification) to get jti and expiry
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.jti) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    // Calculate remaining TTL
    const now = Math.floor(Date.now() / 1000);
    const ttl = decoded.exp ? decoded.exp - now : 3600;

    if (ttl > 0) {
      // Add to blacklist with TTL = remaining token lifetime
      await redis.setex(`blacklist:${decoded.jti}`, ttl, '1');
      console.log(`Blacklisted token jti=${decoded.jti} for ${ttl}s (user ${decoded.sub})`);
    }

    // Clear cached permissions
    await redis.del(`permissions:${decoded.sub}`);

    return res.json({ message: 'token_revoked' });
  } catch (error) {
    console.error('Revocation error', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Health check for permissions
app.get('/permissions/:userId', async (req, res) => {
  try {
    const data = await redis.get(`permissions:${req.params.userId}`);
    if (!data) return res.status(404).json({ error: 'no_cached_permissions' });
    return res.json(JSON.parse(data));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.listen(port, () => {
  console.log(`IdP service listening on port ${port}`);
});
