const { KafkaConfig, KafkaClient } = require('common');
const { Response } = require('common/Message');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_PLACEHOLDER';
const STOREFRONT_URL = process.env.STOREFRONT_URL || 'http://localhost:4001';

const stripe = require('stripe')(STRIPE_SECRET_KEY);

// Kafka setup using common-js library (same pattern as api-gateway)
const config = new KafkaConfig()
    .setClusterId('e-commerce')
    .setNodeId('payment-service')
    .setBrokers(['kafka:9092']);

const kafkaClient = new KafkaClient(config);

// Route handlers
const handlers = {};

function handle(uri, fn) {
    handlers[uri] = fn;
}

// Track active polling sessions
const activeSessions = new Map();

async function start() {
    await kafkaClient.connect();

    // Listen for requests + responses
    const consumer = kafkaClient.kafka.consumer({ groupId: 'payment-service-group' });
    await consumer.connect();
    await consumer.subscribe({ topic: 'payment-service-topic', fromBeginning: false });
    await consumer.subscribe({ topic: config.responseTopic(), fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, message: kafkaMessage }) => {
            try {
                const msg = JSON.parse(kafkaMessage.value.toString());

                // Handle responses (for our outgoing requests)
                if (topic === config.responseTopic()) {
                    kafkaClient.handleResponse(msg);
                    return;
                }

                // Handle incoming requests
                const uri = msg.uri;
                const handler = handlers[uri];

                if (!handler) {
                    console.error('Unknown route:', uri);
                    if (msg.responseDestination && msg.responseDestination.topic) {
                        await kafkaClient.sendResponse(msg, Response.systemErrorResponse('UNKNOWN_ROUTE'));
                    }
                    return;
                }

                try {
                    const result = await handler(msg.data);
                    await kafkaClient.sendResponse(msg, Response.dataResponse(result));
                } catch (error) {
                    console.error(`Error handling ${uri}:`, error.message);
                    await kafkaClient.sendResponse(msg, Response.systemErrorResponse(error.message));
                }
            } catch (e) {
                console.error('Error processing message:', e.message);
            }
        }
    });

    console.log('Payment service started, listening on Kafka.');
}

// Handler: Create Stripe Checkout Session
handle('/payments/create-session', async (data) => {
    const { orderId, productName, priceInCents } = data;

    console.log(`Creating Stripe checkout session for order ${orderId}: ${productName} @ ${priceInCents} cents`);

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
            price_data: {
                currency: 'usd',
                product_data: { name: productName },
                unit_amount: priceInCents,
            },
            quantity: 1,
        }],
        mode: 'payment',
        success_url: `${STOREFRONT_URL}?order=${orderId}&stripe=success`,
        cancel_url: `${STOREFRONT_URL}?order=${orderId}&stripe=cancelled`,
        metadata: { orderId: String(orderId) },
    });

    console.log(`Stripe session created: ${session.id} → ${session.url}`);

    // Start polling for this session
    startPolling(session.id, orderId);

    return {
        checkoutUrl: session.url,
        sessionId: session.id
    };
});

function startPolling(stripeSessionId, orderId) {
    console.log(`Started polling Stripe session ${stripeSessionId} for order ${orderId}`);

    const intervalId = setInterval(async () => {
        try {
            const session = await stripe.checkout.sessions.retrieve(stripeSessionId);

            if (session.payment_status === 'paid') {
                console.log(`✅ Payment confirmed for order ${orderId}`);
                clearInterval(intervalId);
                activeSessions.delete(stripeSessionId);

                await kafkaClient.sendRequest('order-service-topic', '/orders/update-status', {
                    orderId,
                    status: 'PAID',
                    stripeSessionId
                });

            } else if (session.status === 'expired') {
                console.log(`❌ Session expired for order ${orderId}`);
                clearInterval(intervalId);
                activeSessions.delete(stripeSessionId);

                await kafkaClient.sendRequest('order-service-topic', '/orders/update-status', {
                    orderId,
                    status: 'REJECTED',
                    stripeSessionId
                });
            }
        } catch (error) {
            console.error(`Polling error for session ${stripeSessionId}:`, error.message);
        }
    }, 5000);

    activeSessions.set(stripeSessionId, { orderId, intervalId });

    // Safety timeout: stop polling after 30 minutes
    setTimeout(() => {
        if (activeSessions.has(stripeSessionId)) {
            clearInterval(intervalId);
            activeSessions.delete(stripeSessionId);
            console.log(`Polling timed out for session ${stripeSessionId}`);
        }
    }, 30 * 60 * 1000);
}

start().catch(console.error);
