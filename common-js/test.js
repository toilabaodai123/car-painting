const { KafkaConfig, KafkaClient } = require('./index');
const { Kafka } = require('kafkajs');

async function run() {
    console.log("Setting up common-js test instance...");

    const config = new KafkaConfig()
        .setClusterId('e-commerce')
        .setNodeId('node-test-client')
        .setBrokers(['kafka:9092']);

    const client = new KafkaClient(config);
    await client.connect();

    // Setup Consumer just like @KafkaListener
    const kafka = new Kafka({ clientId: 'node-test-client', brokers: config.brokers });
    const consumer = kafka.consumer({ groupId: 'node-test-group' });

    await consumer.connect();
    await consumer.subscribe({ topic: config.responseTopic(), fromBeginning: false });

    // Background listener
    consumer.run({
        eachMessage: async ({ message }) => {
            const payload = message.value.toString();
            try {
                const msg = JSON.parse(payload);
                client.handleResponse(msg);
            } catch (e) {
                console.error("Failed to parse response", e);
            }
        }
    });

    console.log("Listener ready. Attempting to hit Java Service B via Kafka...");

    try {
        const response = await client.sendRequest('service-b-topic', '/call-b', null);
        console.log("\n✅ SUCCESS! Received Java response in Node.js:\n");
        console.log(JSON.stringify(response, null, 2));
    } catch (e) {
        console.error("\n❌ FAILED:", e.message);
    } finally {
        await consumer.disconnect();
        process.exit(0);
    }
}

run();
