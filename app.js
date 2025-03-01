"use strict";

const express = require("express");
const app = express();

const cmd = require("node-cmd");
const crypto = require("crypto"); 
const bodyParser = require("body-parser");

const fs = require("fs");
const dotenv = require("dotenv").config();
const debug = process.env.DEBUG || "true";

let options;
if (!debug) {
    options = {
        key: fs.readFileSync(process.env.KEY_PATH),
        cert: fs.readFileSync(process.env.CERT_PATH)
    };
}

const https = require("https").createServer(options, app);

// default -- pingInterval: 1000 * 25, pingTimeout: 1000 * 60
// low latency -- pingInterval: 1000 * 5, pingTimeout: 1000 * 10
let io, http;
const ping_interval = 1000 * 5;
const ping_timeout = 1000 * 10;
const port_http = process.env.PORT_HTTP || 8080;
const port_https = process.env.PORT_HTTPS || 443;
const port_ws = process.env.PORT_WS || 4321;

if (!debug) {
    http = require("http");

    http.createServer(function(req, res) {
        res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
        res.end();
    }).listen(port_http);

    io = require("socket.io")(https, { 
        pingInterval: ping_interval,
        pingTimeout: ping_timeout
    });
} else {
    http = require("http").Server(app);

    io = require("socket.io")(http, { 
        pingInterval: ping_interval,
        pingTimeout: ping_timeout
    });
}
   
app.use(express.static("public")); 

app.use(bodyParser.json());

app.get("/", function(req, res) {
    res.sendFile(__dirname + "/public/index.html");
});

if (!debug) {
    https.listen(port_https, function() {
        console.log("\nNode.js listening on https port " + port_https);
    });
} else {
    http.listen(port_http, function() {
        console.log("\nNode.js listening on http port " + port_http);
    });
}

const strokeLifetime = 10000;

class Frame {
    constructor() {
        this.strokes = [];
    }
}

class Layer {
    constructor() {
        this.frames = [];
    }

    getFrame(index) {
        if (!this.frames[index]) {
            for (let i=0; i<index+1; i++) {
                if (!this.frames[i]) {
                    let frame = new Frame();
                    this.frames.push(frame); 
                }
            }
        }
        return this.frames[index];
    }

    addStroke(data) {
        try {
            let index = data["index"];
            if (!isNaN(index)) {
                this.getFrame(index); 

                this.frames[index].strokes.push(data); 
                console.log("<<< Received a stroke with color (" + data["color"] + ") and " + data["points"].length + " points.");
            }
        } catch (e) {
            console.log("Error adding stroke" + e.data);
        }
    }
}

let layer = new Layer();

setInterval(function() {
    for (let i=0; i<layer.frames.length; i++) {
        layer.frames[i].strokes.shift();
        console.log("X Removing oldest stroke from frame " + i + ".");
    }
}, strokeLifetime);

io.on("connection", function(socket) {
    console.log("A socket.io user connected.");

    socket.on("disconnect", function(event) {
        console.log("A socket.io user disconnected.");
    });

    socket.on("clientStrokeToServer", function(data) { 
        try { // json coming from Unity needs to be parsed...
            let newData = JSON.parse(data);
            layer.addStroke(newData);
        } catch (e) { // ...but json coming from JS client does not need to be
            layer.addStroke(data);
        }
    });

    socket.on("clientRequestFrame", function(data) {
        let index = data["num"];
        if (index != NaN) {
            let frame = layer.getFrame(index);
            if (frame && frame.strokes.length > 0) {
                io.emit("newFrameFromServer", frame.strokes);
                console.log("> > > Sending a new frame " + frame.strokes[0]["index"] + " with " + frame.strokes.length + " strokes.");
            }
        }
    });
});