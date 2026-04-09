FROM node:20-alpine AS build
WORKDIR /app

# Copy dependency files
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Production server
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
