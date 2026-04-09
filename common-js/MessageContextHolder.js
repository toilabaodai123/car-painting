const { AsyncLocalStorage } = require('async_hooks');

const asyncLocalStorage = new AsyncLocalStorage();

class MessageContextHolder {
    static run(context, callback) {
        let store = asyncLocalStorage.getStore();
        if (!store) store = {};
        Object.assign(store, context);
        return asyncLocalStorage.run(store, callback);
    }

    static clear() {
        // In Node, Context automatically cleans up when the async execution tree resolves
    }

    static get() {
        return asyncLocalStorage.getStore() || {};
    }

    static getTransactionId() {
        return this.get().transactionId;
    }

    static setTransactionId(tid) {
        const store = this.get();
        if(store) store.transactionId = tid;
    }
    
    static getMessageId() { return this.get().messageId; }
    static setMessageId(id) { const store = this.get(); if(store) store.messageId = id; }

    static getSourceId() { return this.get().sourceId; }
    static setSourceId(id) { const store = this.get(); if(store) store.sourceId = id; }

    static getUri() { return this.get().uri; }
    static setUri(uri) { const store = this.get(); if(store) store.uri = uri; }
}

module.exports = MessageContextHolder;
