FROM node:18-alpine

WORKDIR /app

# Copy custom commons library directly since NPM won't have it
COPY common-js /common-js
COPY api-gateway/package*.json ./

RUN npm install

COPY api-gateway/index.js ./

EXPOSE 3000

CMD ["node", "index.js"]
