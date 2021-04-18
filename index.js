const fs = require('fs')
const https = require('https')
const WebSocket = require('ws')
const url = require('url');

let vttReceivers = []

function receiver_remove(ws) {
  vttReceivers = vttReceivers.filter(receiver => receiver != ws);
}

const server = https.createServer({
  cert: fs.readFileSync('./config/certs/snakeoil.pem'),
  key: fs.readFileSync('./config/certs/snakeoil.key')
}, function httpRequest(req, res) {
  fs.readFile('../test/keypad.html', function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end(JSON.stringify(err));
      return;
    }
    res.writeHead(200);
    res.end(data);
  })
})

const wss = new WebSocket.Server({ noServer: true })

function noop() {}
function heartbeat() {
  this.isAlive = true;
}

// check all connection by sending a ping every 30 seconds
const interval = setInterval(function ping() {
  wss.clients.forEach(function pingWebsocket(ws) {
    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;
    ws.ping(noop);
  });
}, 30000);

wss.on('connection', function connection(ws) {
  ws.isAlive = true;
  ws.on('pong', heartbeat)

  ws.on('message', function incoming(message) {
    console.debug('received: %s', message)
    const data = JSON.parse(message)

    if(data.hasOwnProperty('controller-id')) {
      heartbeat.apply(this)
      vttReceivers.forEach(receiver => {
        receiver.send(JSON.stringify(data))
      })
      console.debug('sent message to %d receivers', vttReceivers.length)
    } else if(data.hasOwnProperty('receiver')) {
      heartbeat.apply(this)
      if(data.receiver && !vttReceivers.includes(ws)) {
        vttReceivers.push(ws)
      } else if(!data.receiver && vttReceivers.includes(ws)) {
        receiver_remove(ws)
      }
    }
  });

  ws.on('close', function() {
    console.info('client disconnected')
    receiver_remove(ws)
  })
});

wss.on('close', function close() {
  clearInterval(interval)
});

server.on('upgrade', function upgrade(request, socket, head) {
  const pathname = url.parse(request.url).pathname;

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(10443)

