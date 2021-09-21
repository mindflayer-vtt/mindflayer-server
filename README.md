<div align="center">
<img width="460" src="https://raw.githubusercontent.com/mindflayer-vtt/mindflayer-server/main/.github/foundryvtt-mindflayer-logo.png">
</div>

# Mind Flayer - WebSocket Server
[![Docker Automated build](https://img.shields.io/badge/docker%20build-automated-brightgreen)](https://github.com/mindflayer-vtt/mindflayer-server/actions) [![GitHub Workflow Status](https://img.shields.io/github/workflow/status/mindflayer-vtt/mindflayer-server/Docker)](https://github.com/mindflayer-vtt/mindflayer-server/actions) [![Docker Pulls](https://img.shields.io/docker/pulls/mindflayervtt/server)](https://hub.docker.com/r/mindflayervtt/server) [![Docker Image Size (tag)](https://img.shields.io/docker/image-size/mindflayervtt/server/latest)](https://hub.docker.com/r/mindflayervtt/server) [![GitHub Release](https://img.shields.io/github/release/mindflayer-vtt/mindflayer-server.svg)](https://github.com/mindflayer-vtt/mindflayer-server/releases/latest)

WebSocket server component used for communicating with the [Mind Flayer VTT module](https://github.com/mindflayer-vtt/foundryvtt-mindflayer) and external devices

## Usage

To get the [Mind Flayer VTT module](https://github.com/mindflayer-vtt/foundryvtt-mindflayer) to work, this WebSocket server is a base requirement, without it there is no communication between VTT and your control devices.

## Installation

### Docker

You need to install Docker first. Afterwards you can run the server:

```sh
docker run -d --restart unless-stopped --name mindflayer-server -p 10443:10443 mindflayer-vtt/server
```

### Docker Compose

You can use the following yml with docker-compose as well, copy the compose config down below into a file named docker-compose.yml

```yml
version: "3"

services:
  mindflayer-server:
    container_name: mindflayer-server
    image: mindflayer-vtt/server
    ports:
      - 10443:10443/tcp
    restart: unless-stopped
```

Then run

```sh
docker-compose up -d
```

### Manual

If you want to run it on your machine without docker, you need to install NodeJS 14. Afterwards check out the repository:

```sh
git clone https://github.com/mindflayer-vtt/mindflayer-server
```

Install dependencies

```sh
npm install --production
```

Run the srver

```sh
npm start
```

### Verify

To see if the server is running, simply open https://localhost:10443 in your local browser, you should see the test client app. (replace localhost with the IP or hostname of your actual host where you installed the server)
