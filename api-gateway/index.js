const express = require('express');
const cors = require('cors');
const { KafkaConfig, KafkaClient } = require('common');
const Redis = require('ioredis');
const axios = require('axios');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Redis client
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const redis = new Redis({ host: REDIS_HOST, port: 6379, retryStrategy: (times) => Math.min(times * 500, 3000) });
redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err.message));

// Setup Kafka Client
const config = new KafkaConfig()
    .setClusterId('e-commerce')
    .setNodeId('api-gateway')
    .setBrokers(['kafka:9092']);

const kafkaClient = new KafkaClient(config);

async function start() {
    await kafkaClient.connect();

    // Listen for incoming response topics for api-gateway
    const consumer = kafkaClient.kafka.consumer({ groupId: 'api-gateway-group' });
    await consumer.connect();
    await consumer.subscribe({ topic: 'e-commerce.response.api-gateway', fromBeginning: false });
    
    await consumer.run({
        eachMessage: async ({ message }) => {
            const payload = JSON.parse(message.value.toString());
            kafkaClient.handleResponse(payload);
        }
    });

    // Public routes (no auth)
    app.get('/users', async (req, res) => {
        try {
            const response = await kafkaClient.sendRequest('user-service-topic', '/users', null);
            res.json(response.data);
        } catch (error) {
            console.error("Error fetching users:", error);
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    });

    app.get('/products', async (req, res) => {
        try {
            const response = await kafkaClient.sendRequest('product-service-topic', '/products', null);
            res.json(response.data);
        } catch (error) {
            console.error("Error fetching products:", error);
            res.status(500).json({ error: 'Failed to fetch products' });
        }
    });

    // JWT Middleware — now checks Redis blacklist
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

    const authenticateToken = async (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token == null) return res.status(401).json({ error: 'unauthorized' });

        try {
            const user = jwt.verify(token, JWT_SECRET);

            // Check Redis blacklist
            if (user.jti) {
                const isBlacklisted = await redis.get(`blacklist:${user.jti}`);
                if (isBlacklisted) {
                    console.log(`Blocked blacklisted token jti=${user.jti}`);
                    return res.status(401).json({ error: 'token_revoked' });
                }
            }

            req.user = user;
            req.token = token;
            next();
        } catch (err) {
            return res.status(403).json({ error: 'forbidden' });
        }
    };

    const checkAccess = async (req, res, next) => {
        if (!req.user) {
            return res.status(403).json({ error: 'Access denied' });
        }

        try {
            const authResponse = await axios.post('http://authz-service:3002/evaluate', {
                userId: req.user.sub,
                method: req.method,
                path: req.route.path
            });

            if (authResponse.data.allowed) {
                req.user.role = authResponse.data.role;
                req.user.permissions = authResponse.data.permissions;
                return next();
            } else {
                return res.status(403).json({ error: 'Access denied by AuthZ sidecar' });
            }
        } catch (error) {
            console.error('AuthZ Service Error:', error.message);
            return res.status(500).json({ error: 'Authorization service unavailable' });
        }
    };

    // ADMIN: Get all orders (aggregated)
    app.get('/orders', authenticateToken, checkAccess, async (req, res) => {
        try {
            const response = await kafkaClient.sendRequest('order-service-topic', '/orders', null);
            res.json(response.data);
        } catch (error) {
            console.error("Error fetching orders:", error);
            res.status(500).json({ error: 'Failed to fetch orders' });
        }
    });

    // USER/ADMIN: Create order → Stripe checkout
    app.post('/orders', authenticateToken, checkAccess, async (req, res) => {
        try {
            const userId = req.user.sub;
            const productId = req.body.productId;

            // Step 1: Create order in PENDING state
            const orderResponse = await kafkaClient.sendRequest('order-service-topic', '/orders/create', {
                userId,
                productId
            });
            const orderId = orderResponse.data.id;

            // Step 2: Fetch product details to get price
            const productResponse = await kafkaClient.sendRequest('product-service-topic', '/products', null);
            const products = productResponse.data;
            const product = Array.isArray(products) ? products.find(p => p.id === productId) : null;

            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }

            const priceInCents = Math.round(product.price * 100);

            // Step 3: Create Stripe checkout session via payment-service
            const paymentResponse = await kafkaClient.sendRequest('payment-service-topic', '/payments/create-session', {
                orderId,
                productName: product.name,
                priceInCents
            });

            // Step 4: Return orderId + checkout URL to frontend
            res.json({
                orderId,
                checkoutUrl: paymentResponse.data.checkoutUrl,
                status: 'PENDING'
            });

        } catch (error) {
            console.error("Error creating order:", error);
            res.status(500).json({ error: 'Failed to create order: ' + error.message });
        }
    });

    // USER/ADMIN: Request orders export (CSV) via Go microservice
    app.get('/exports/orders', authenticateToken, checkAccess, async (req, res) => {
        try {
            // Forward headers so export-service can evaluate permissions
            const headers = {
                'X-User-Id': String(req.user.sub),
                'X-User-Permissions': req.user.permissions?.join(',') || ''
            };

            const response = await kafkaClient.sendRequest('export-service-topic', '/exports/orders', null, headers);
            
            // The Go service returns a Presigned URL pointing to Minio (port 9000).
            // E.g., http://minio:9000/exports/orders-export-123.csv?...
            // We need to replace "minio:9000" with "localhost:9000" so the browser can reach it
            let url = response.data.downloadUrl;
            if (url) {
                url = url.replace('http://minio:9000', 'http://localhost:9000');
            }

            res.json({
                downloadUrl: url,
                fileName: response.data.fileName
            });
        } catch (error) {
            console.error("Error generating export:", error);
            res.status(500).json({ error: 'Export failed: ' + error.message });
        }
    });

    // Proxy logout to IdP revoke endpoint
    app.post('/auth/logout', authenticateToken, async (req, res) => {
        try {
            const resp = await fetch('http://idp-service:3001/oauth/revoke', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${req.token}` }
            });
            const data = await resp.json();
            res.json(data);
        } catch (error) {
            console.error("Logout error:", error);
            res.status(500).json({ error: 'logout_failed' });
        }
    });

    app.listen(port, () => {
        console.log(`API Gateway listening on port ${port}`);
    });
}

start().catch(console.error);
