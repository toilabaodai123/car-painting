FROM node:18-alpine

WORKDIR /app

# Copy custom commons library directly since NPM won't have it
COPY common-js /common-js
COPY user-service-node/package*.json ./

RUN npm install

COPY user-service-node/index.js ./

CMD ["node", "index.js"]
