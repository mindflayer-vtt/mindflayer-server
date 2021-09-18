#
# mindflayer-server Dockerfile
#
# https://github.com/shawly/mindflayer-server
#

# Add some build args
ARG NODE_VERSION=14-alpine

# Set base images (necessary for multi-arch building via GitHub workflows)
FROM node:${NODE_VERSION} as node-amd64

FROM node:${NODE_VERSION} as node-386

FROM node:${NODE_VERSION} as node-s390x

FROM node:${NODE_VERSION} as node-armv6

FROM node:${NODE_VERSION} as node-armv7

FROM node:${NODE_VERSION} as node-arm64v8

FROM node:${NODE_VERSION} as node-ppc64le

# Use Node 14 base image
FROM node-${TARGETARCH:-amd64}${TARGETVARIANT}:${NODE_VERSION}

# Run in production mode
ENV NODE_ENV=production

# Switch to /app directory
WORKDIR /app

# Add node server files to /app directory
ADD . /app

# Install the server dependencies
RUN npm install --production

# Expose the node server port
EXPOSE 10443

# Start the server
CMD [ "npm", "start" ]
