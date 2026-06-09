# Base Image
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json and lock files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production Image
FROM node:20-alpine

WORKDIR /app

# Install pm2 globally
RUN npm install pm2 -g

# Copy necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/ecosystem.config.js ./

# Install only production dependencies
RUN npm ci --only=production

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Start the application using PM2
CMD ["pm2-runtime", "start", "ecosystem.config.js", "--env", "production"]
