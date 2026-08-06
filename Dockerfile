FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests
COPY package.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY server/ ./server/
COPY public/ ./public/

# Set persistent data directory
ENV PORT=8080
ENV DATA_DIR=/app/data
ENV NODE_ENV=production

# Create volume mount point for storage
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8080

CMD ["node", "server/index.js"]
