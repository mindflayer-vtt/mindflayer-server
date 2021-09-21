#
# mindflayer-server Dockerfile
#
# https://github.com/mindflayer-vtt/mindflayer-server
#

# Add some build args
ARG NODE_VERSION=14-alpine

# Set base images (necessary for multi-arch building via GitHub workflows)
FROM node:${NODE_VERSION} as node-amd64

FROM node:${NODE_VERSION} as node-386

FROM node:${NODE_VERSION} as node-s390x

# fix for gyp missing python
RUN apk add --update --no-cache \
      python3

FROM node:${NODE_VERSION} as node-armv6

FROM node:${NODE_VERSION} as node-armv7

FROM node:${NODE_VERSION} as node-arm64

# fix for gyp missing python
RUN apk add --update --no-cache \
      python3

FROM node:${NODE_VERSION} as node-ppc64le

# fix for gyp missing python
RUN apk add --update --no-cache \
      python3

# Use Node 14 base image
FROM node-${TARGETARCH:-amd64}${TARGETVARIANT}

# Run in production mode
ENV NODE_ENV=production

# Switch to /app directory
WORKDIR /app

# Add node server files to /app directory
ADD . /app

# Install the server dependencies
RUN \
  apk add --update --no-cache \
    python3 \
    git && \
  npm install --production

# Expose the node server port
EXPOSE 10443

# Start the server
CMD [ "npm", "start" ]
