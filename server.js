var http = require('http');
var spdy = require('spdy');
var heapdump = require('heapdump');
var argo = require('argo');
var titan = require('titan');
var WebSocketServer = require('ws').Server;
var SpdyAgent = require('./spdy_agent');
var WebSocket = require('./web_socket');

var server = spdy.createServer({
  windowSize: 1024 * 1024,
  plain: true,
  ssl: false
});

var spdyServer = spdy.createServer({
  windowSize: 1024 * 1024,
  plain: true,
  ssl: false
});

var SensorInterval = 20;
var TopicSubscriptions = 50;

var topics = 0;
var cloud = argo()
  .use(titan)
  .allow({
    methods: ['DELETE', 'PUT', 'PATCH', 'POST'],
    origins: ['*'],
    headers: ['accept', 'content-type'],
    maxAge: '432000'
  })
  .use(function(handle) {
    handle('request', function(env, next) {
      if (env.response.push) {
        // spdy
//        console.log('topic started', ++topics);

        var send = function() {
          var data = new Buffer(JSON.stringify({ timestamp: new Date().getTime() }));

          var stream = env.response.push('/event', { 'Host': 'fog.argo.cx',
                                                     'Content-Length': data.length
                                                   });

          stream.on('error', function(err) {
            if (err.code === 'RST_STREAM' && err.status === 3) {
              stream.end();
            } else {
              console.log(err);
            }
          });

          stream.end(data);
        }

        env.response.connection.setTimeout(0); // keep connection alive
        env.response.writeHead(200);
        var timer = setInterval(send, SensorInterval);
        env.request.connection.on('close', function() { 
          console.log('env req close');
          clearInterval(timer);
        });
        env.response.on('close', function() { 
          console.log('env res close')
          clearInterval(timer);
        });

      } else {
        next(env);
      }
    });
  })

cloud = cloud.build();
server.on('request', cloud.run);
spdyServer.on('request', cloud.run);

var wss = new WebSocketServer({ server: server });
wss.on('connection', function(ws) {
//  console.log('ws connect')
  ws._socket.removeAllListeners('data'); // Remove WebSocket data handler.

  ws.on('error', function(err) {
    console.log(err)
  })

  agent = spdy.createAgent(SpdyAgent, {
    host: this.name,
    port: 80,
    socket: ws._socket,
    spdy: {
      plain: true,
      ssl: false
    }
  });
  
  var pushEvents = 0;
  setInterval(function() {
    console.log(pushEvents + ' per second', Object.keys(agent._spdyState.connection._spdyState.streams).length);
    pushEvents = 0;
  }, 1000);
  
  agent.maxSockets = 150;
  agent.on('error', function(err) {
    console.log('agent error:', err);
    agent.close();
  });
  agent.on('push', function(stream) {

    pushEvents++;
    var encoding = stream.headers['x-event-encoding'] || 'json';
    var length = Number(stream.headers['content-length']);
    var data = new Buffer(length);
    var idx = 0;
    var d = null;
    stream.on('readable', function() {
      while (d = stream.read()) {
        for (var i=0; i<d.length;i++) {
          data[idx++] = d[i];
        }
      };
    });

    stream.on('error', function(err) {
      console.log('stream error:', err)
    })

    stream.on('end', function() {
      var body = null;
      body = JSON.parse(data.toString());
      stream.connection.close();
      stream.destroy();
    });
  });

  var started = 0;
  function start() {
    var host;
    if(ws && ws.upgradeReq) {
      host = ws.upgradeReq.headers.host
    } else {
      host = 'fog.argo.cx';
    }

    var opts = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Host': host
      },
      path: '/start/from/spdy',
      agent: agent
    };

//    Object.keys(agent.sockets).forEach(function(k) {
//      console.log(k, agent.sockets[k].length);
  //  });

    var req = http.request(opts, function(res) {
      res.on('data', function(data) {
      });
    });
    req.on('error', function(err) {
      console.log('req error:', err)
    })
    req.end();
  }

  for (var i=0; i<TopicSubscriptions; i++) {
    start();
  }
});


if (process.argv[3]) {
  var ws = new WebSocket(process.argv[3], {});
  ws.on('open', function onOpen(socket) {
    spdyServer.emit('connection', socket);
  });
  ws.start();
}

server.listen(process.argv[2]);
