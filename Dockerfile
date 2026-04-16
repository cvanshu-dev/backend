# Stage 1: The Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy the entire project (including local plugins and src)
COPY . .

# Run the build (this generates the .medusa folder)
RUN npm run build

# Stage 2: The Runtime Stage
FROM node:20-alpine

WORKDIR /app

# 1. Copy essential package files
COPY package*.json ./

# 2. Copy the heavy hitters from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.medusa ./.medusa

# 3. Copy configuration and scripts
COPY --from=builder /app/medusa-config.* ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/public ./public

# 4. CRITICAL: Copy the source and local plugins
# Without these, Medusa cannot find your custom links, subscribers, or the Razorpay provider
COPY --from=builder /app/src ./src
COPY --from=builder /app/razorpay-plugin ./razorpay-plugin

# 5. Link the Medusa binary for your start.js script
RUN ln -s /app/node_modules/.bin/medusa /usr/local/bin/medusa

# Set production environment
ENV NODE_ENV=production

# Expose the default Medusa port
EXPOSE 3000

# Fire it up
CMD ["node", "scripts/start.js"]