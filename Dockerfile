# Stage 1: The Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy everything and build
COPY . .
RUN npm run build

# Stage 2: The Runtime Stage
FROM node:20-alpine

WORKDIR /app

# Copy only what is strictly necessary for production
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.medusa ./.medusa
COPY --from=builder /app/medusa-config.* ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/public ./public

# Link the medusa binary so your start.js script can find it
RUN ln -s /app/node_modules/.bin/medusa /usr/local/bin/medusa

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "scripts/start.js"]