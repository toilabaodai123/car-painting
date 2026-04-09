const { Response } = require('./Message');
const MessageContextHolder = require('./MessageContextHolder');

class RequestHandler {
    constructor(config, client) {
        this.config = config;
        this.client = client;
        this.routes = new Map();
    }

    handle(uri, handlerFunc) {
        this.routes.set(uri, handlerFunc);
    }

    async dispatch(jsonPayload) {
        let msg;
        try {
            msg = JSON.parse(jsonPayload);
        } catch (e) {
            console.error("failed to parse kafka message", e);
            return;
        }

        if (this.config.timeDiffIgnoreMs > 0 && msg.timestamp) {
            const age = Date.now() - msg.timestamp;
            if (age > this.config.timeDiffIgnoreMs) {
                console.warn(`dropping stale message msgId: ${msg.messageId} age: ${age}`);
                return;
            }
        }

        const context = {
            transactionId: msg.transactionId,
            messageId: msg.messageId,
            sourceId: msg.sourceId,
            uri: msg.uri
        };

        // Run within Async context block to emulate ThreadLocal boundaries
        await MessageContextHolder.run(context, async () => {
            const start = Date.now();
            try {
                const handler = this.routes.get(msg.uri);
                if (!handler) {
                    throw new Error(`URI_NOT_FOUND: ${msg.uri}`);
                }

                let data = handler(msg);
                if (data instanceof Promise) {
                    data = await data;
                }
                
                if (data !== undefined && msg.responseDestination) {
                    const resp = Response.dataResponse(data);
                    await this.client.sendResponse(msg, resp);
                }

                console.log(`← response OK uri: ${msg.uri} took: ${Date.now() - start}ms`);

            } catch (err) {
                console.warn(`← response ERROR uri: ${msg.uri} took: ${Date.now() - start}ms error: ${err.message}`);
                
                if (msg.responseDestination) {
                    try {
                        const resp = Response.systemErrorResponse('GENERAL_ERROR');
                        await this.client.sendResponse(msg, resp);
                    } catch (sendErr) {
                        console.error("failed to send error response", sendErr);
                    }
                }
            }
        });
    }
}

module.exports = RequestHandler;
