#
# mindflayer-server Dockerfile
#
# https://github.com/mindflayer-vtt/mindflayer-server
#

# Add some build args
ARG NODE_VERSION=24-alpine

# Use the supported Node 24 LTS base image
FROM node:$NODE_VERSION

# Run in production mode
ENV NODE_ENV=production

# Switch to /app directory
WORKDIR /app

# Copy dependency manifests separately so installs can be cached
COPY --chown=node:node package.json package-lock.json ./

# Install the server dependencies
RUN \
  apk add --update --no-cache --virtual .gyp-fix \
    g++ \
    make \
    python3 \
    git && \
  npm ci --omit=dev && \
  apk del .gyp-fix

# Copy node server files to /app directory
COPY --chown=node:node . .

# Run the server without root privileges
USER node

# Foundry traffic is plain HTTP/WS for a browser-trusted reverse proxy. Keypads
# connect directly to the separate TLS listener.
EXPOSE 8080 10443

# Start the server
CMD [ "npm", "start" ]
