const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Redis = require('ioredis');
const bcrypt = require('bcrypt');
const { Kafka } = require('kafkajs');

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const port = 3001;

// Redis client (used for blacklist and refresh token storage)
const redis = new Redis({ host: REDIS_HOST, port: 6379, retryStrategy: (times) => Math.min(times * 500, 3000) });
redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err.message));

// Kafka Setup
const kafka = new Kafka({
  clientId: 'idp-service',
  brokers: ['kafka:9092']
});
const producer = kafka.producer();

// Connect to Identity Store Database
const pool = new Pool({
  user: 'user',
  host: 'postgres-idp',
  database: 'idpdb',
  password: 'password',
  port: 5432,
});

async function initDB() {
    let connected = false;
    while (!connected) {
        try {
            await producer.connect();
            console.log('IDP Kafka Producer connected');

            // Credentials Table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS credentials (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    user_id INTEGER NOT NULL UNIQUE,
                    role VARCHAR(50) DEFAULT 'USER',
                    mfa_enabled BOOLEAN DEFAULT false
                );
            `);
            await pool.query('ALTER TABLE credentials ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false;').catch(() => {});
            
            // Clients Table for OAuth2 Client Verification
            await pool.query(`
                CREATE TABLE IF NOT EXISTS clients (
                    client_id VARCHAR(100) PRIMARY KEY,
                    client_secret VARCHAR(255) NOT NULL,
                    client_name VARCHAR(100)
                );
            `);

            // Seed Users
            const credsRes = await pool.query('SELECT COUNT(*) FROM credentials');
            if (parseInt(credsRes.rows[0].count) === 0) {
                const aliceHash = await bcrypt.hash('password123', 10);
                const bobHash = await bcrypt.hash('password123', 10);
                await pool.query("INSERT INTO credentials (username, password, user_id, role) VALUES ('Alice', $1, 1, 'USER')", [aliceHash]);
                await pool.query("INSERT INTO credentials (username, password, user_id, role) VALUES ('Bob', $1, 2, 'ADMIN')", [bobHash]);
                console.log("Credentials DB populated with Users.");
            }

            // Seed Clients
            const clientsRes = await pool.query('SELECT COUNT(*) FROM clients');
            if (parseInt(clientsRes.rows[0].count) === 0) {
                await pool.query("INSERT INTO clients (client_id, client_secret, client_name) VALUES ('storefront-client', 'secret123', 'Storefront Web App')");
                console.log("Clients DB populated with default clients.");
            }

            connected = true;
        } catch(e) {
            console.error("Initialization error, retrying...", e.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}
initDB();

// Helper to extract client credentials from Basic Auth or Body
const extractClientCredentials = (req) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Basic ')) {
        const b64auth = authHeader.split(' ')[1];
        const [client_id, client_secret] = Buffer.from(b64auth, 'base64').toString().split(':');
        return { client_id, client_secret };
    }
    return { client_id: req.body.client_id, client_secret: req.body.client_secret };
};

// SECURE REGISTRATION FLOW
app.post('/oauth/register', async (req, res) => {
    const { username, password, name, email, mfa_enabled } = req.body;
    
    if (!username || !password || !name || !email) {
        return res.status(400).json({ error: 'missing_fields' });
    }

    try {
        // 1. Instantly securely hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 2. Insert into IDP credentials DB and act as the ID generator
        const insertQuery = `
            INSERT INTO credentials (username, password, user_id, role, mfa_enabled) 
            VALUES ($1, $2, COALESCE((SELECT MAX(user_id) FROM credentials), 0) + 1, 'USER', $3) 
            RETURNING user_id;
        `;
        const result = await pool.query(insertQuery, [username, hashedPassword, !!mfa_enabled]);
        const newUserId = result.rows[0].user_id;

        // 3. Emit Kafka Event to trigger actual User Service Profile creation locally
        await producer.send({
            topic: 'user-service-topic',
            messages: [
                { 
                    value: JSON.stringify({ 
                        uri: '/users/register', 
                        data: { id: newUserId, name, email } 
                    }) 
                }
            ]
        });

        console.log(`[AUTH] Successfully registered ${username} and broadcasted user_id ${newUserId} to User Service.`);

        return res.status(201).json({ message: 'User registered successfully', user_id: newUserId });
    } catch (e) {
        console.error('Registration failed:', e);
        if (e.constraint === 'credentials_username_key') {
            return res.status(409).json({ error: 'username_taken' });
        }
        return res.status(500).json({ error: 'internal_error' });
    }
});


// OAuth2 Token Endpoint
app.post('/oauth/token', async (req, res) => {
  const { grant_type, username, password, refresh_token } = req.body;
  const { client_id, client_secret } = extractClientCredentials(req);

  // 1. Verify Client
  if (!client_id || !client_secret) {
      return res.status(401).json({ error: 'invalid_client' });
  }

  try {
      const clientRes = await pool.query('SELECT * FROM clients WHERE client_id = $1 AND client_secret = $2', [client_id, client_secret]);
      if (clientRes.rows.length === 0) {
          return res.status(401).json({ error: 'invalid_client' });
      }
  } catch (err) {
      return res.status(500).json({ error: 'server_error' });
  }

  // 2. Grant Type: Password
  if (grant_type === 'password') {
      try {
        const result = await pool.query('SELECT user_id, username, password as hashed_password, role, mfa_enabled FROM credentials WHERE username = $1', [username]);
        const creds = result.rows[0];

        if (!creds) {
          return res.status(400).json({ error: 'invalid_grant' });
        }

        // Compare using bcrypt (fallback to plaintext match for any legacy unhashed dev users)
        const isMatch = await bcrypt.compare(password, creds.hashed_password).catch(() => false);
        if (!isMatch && creds.hashed_password !== password) {
            return res.status(400).json({ error: 'invalid_grant' });
        }

        // MFA Intercept 
        if (creds.mfa_enabled) {
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const mfa_token = crypto.randomUUID();
            const mfaPayload = JSON.stringify({ user_id: creds.user_id, username: creds.username, role: creds.role, otp });
            
            await redis.setex(`mfa:${mfa_token}`, 300, mfaPayload); /* 5 minutes */
            
            console.log(`\n========================================`);
            console.log(`[MFA] OTP for ${creds.username}: ${otp}`);
            console.log(`========================================\n`);

            return res.status(202).json({ mfa_required: true, mfa_token });
        }

        const jti = crypto.randomUUID();
        const access_token = jwt.sign(
          { sub: creds.user_id, username: creds.username, role: creds.role, jti },
          JWT_SECRET,
          { expiresIn: '1h' }
        );

        // Generate Refresh Token (valid for 30 days)
        const generateRefreshToken = crypto.randomBytes(40).toString('hex');
        
        // Store refresh token securely in Redis, linked to the user
        const rtPayload = JSON.stringify({ user_id: creds.user_id, username: creds.username, role: creds.role });
        await redis.setex(`refreshtoken:${generateRefreshToken}`, 30 * 24 * 60 * 60, rtPayload);

        return res.json({
          access_token,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: generateRefreshToken
        });
      } catch (error) {
        console.error('Database query error', error);
        return res.status(500).json({ error: 'server_error' });
      }
  } 
  
  // 3. Grant Type: Refresh Token
  else if (grant_type === 'refresh_token') {
      if (!refresh_token) {
          return res.status(400).json({ error: 'invalid_request', error_description: 'Missing refresh_token' });
      }

      try {
          const raw = await redis.get(`refreshtoken:${refresh_token}`);
          if (!raw) {
              return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' });
          }

          const creds = JSON.parse(raw);

          // Rotate refresh token (revoke old, issue new)
          await redis.del(`refreshtoken:${refresh_token}`);

          const jti = crypto.randomUUID();
          const access_token = jwt.sign(
            { sub: creds.user_id, username: creds.username, role: creds.role, jti },
            JWT_SECRET,
            { expiresIn: '1h' }
          );

          const newRefreshToken = crypto.randomBytes(40).toString('hex');
          const rtPayload = JSON.stringify({ user_id: creds.user_id, username: creds.username, role: creds.role });
          await redis.setex(`refreshtoken:${newRefreshToken}`, 30 * 24 * 60 * 60, rtPayload);

          return res.json({
            access_token,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: newRefreshToken
          });

      } catch (err) {
          console.error('Refresh token error', err);
          return res.status(500).json({ error: 'server_error' });
      }
  } 
  
  // 4. Grant Type: Custom MFA
  else if (grant_type === 'mfa') {
      const { mfa_token, code } = req.body;
      if (!mfa_token || !code) {
          return res.status(400).json({ error: 'invalid_request', error_description: 'Missing mfa_token or code' });
      }

      try {
          const raw = await redis.get(`mfa:${mfa_token}`);
          if (!raw) {
              return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired MFA token' });
          }

          const payload = JSON.parse(raw);
          if (payload.otp !== code) {
              return res.status(401).json({ error: 'invalid_grant', error_description: 'Incorrect OTP code' });
          }

          // OTP valid! Consume it.
          await redis.del(`mfa:${mfa_token}`);

          const jti = crypto.randomUUID();
          const access_token = jwt.sign(
            { sub: payload.user_id, username: payload.username, role: payload.role, jti },
            JWT_SECRET,
            { expiresIn: '1h' }
          );

          const newRefreshToken = crypto.randomBytes(40).toString('hex');
          const rtPayload = JSON.stringify({ user_id: payload.user_id, username: payload.username, role: payload.role });
          await redis.setex(`refreshtoken:${newRefreshToken}`, 30 * 24 * 60 * 60, rtPayload);

          return res.json({
            access_token,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: newRefreshToken
          });

      } catch (err) {
          console.error('MFA Grant error', err);
          return res.status(500).json({ error: 'server_error' });
      }
  }
  
  else {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
});

// FORGOT PASSWORD
app.post('/oauth/password/forgot', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'missing_username' });

    try {
        const result = await pool.query('SELECT user_id, username FROM credentials WHERE username = $1', [username]);
        if (result.rows.length > 0) {
            const creds = result.rows[0];
            const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
            await redis.setex(`reset:${username}`, 900, resetCode); // 15 mins

            console.log(`\n========================================`);
            console.log(`[RESET] Code for ${username}: ${resetCode}`);
            console.log(`========================================\n`);
        }
        // Always return 200 to prevent enumeration
        return res.json({ message: 'If the username exists, a reset code was generated.' });
    } catch (e) {
        console.error('Forgot password error', e);
        return res.status(500).json({ error: 'server_error' });
    }
});

// RESET PASSWORD
app.post('/oauth/password/reset', async (req, res) => {
    const { username, code, new_password } = req.body;
    if (!username || !code || !new_password) return res.status(400).json({ error: 'missing_fields' });

    try {
        const storedCode = await redis.get(`reset:${username}`);
        if (!storedCode || storedCode !== code) {
            return res.status(400).json({ error: 'invalid_code' });
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE credentials SET password = $1 WHERE username = $2', [hashedPassword, username]);
        await redis.del(`reset:${username}`);

        return res.json({ message: 'Password has been reset successfully.' });
    } catch (e) {
        console.error('Reset password error', e);
        return res.status(500).json({ error: 'server_error' });
    }
});

// LOGOUT — Revoke Access Token and Refresh Token
app.post('/oauth/revoke', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const { refresh_token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'missing_token' });
  }

  try {
    // 1. Blacklist Access Token
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.jti) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    const now = Math.floor(Date.now() / 1000);
    const ttl = decoded.exp ? decoded.exp - now : 3600;

    if (ttl > 0) {
      await redis.setex(`blacklist:${decoded.jti}`, ttl, '1');
      console.log(`Blacklisted token jti=${decoded.jti} for ${ttl}s (user ${decoded.sub})`);
    }

    // 2. Clear Refresh Token if provided
    if (refresh_token) {
        await redis.del(`refreshtoken:${refresh_token}`);
        console.log(`Revoked refresh token.`);
    }

    return res.json({ message: 'token_revoked' });
  } catch (error) {
    console.error('Revocation error', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.listen(port, () => {
  console.log(`IdP service listening on port ${port} (OAuth 2.0 Mode)`);
});
