# ... (Keep Builder stage as is)

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# 1. Copy everything needed for dependencies
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# 2. Copy the Medusa build AND the CLI
# Medusa v2 needs the framework files to boot
COPY --from=builder /app/.medusa ./.medusa

# 3. CRITICAL: Copy the configuration and TS files
# medusa start looks for these in the root (./)
COPY --from=builder /app/medusa-config.* ./
COPY --from=builder /app/tsconfig.json ./

# 4. Copy your custom start script
COPY --from=builder /app/scripts ./scripts

# 5. Copy the Public folder (start.js needs this to move admin files)
COPY --from=builder /app/public ./public

# 6. Ensure the medusa binary is accessible
# We link the local node_modules binary to the global path
RUN ln -s /app/node_modules/.bin/medusa /usr/local/bin/medusa

# Set production environment
ENV NODE_ENV=production

EXPOSE 3000

# Start via your script
CMD ["node", "scripts/start.js"]