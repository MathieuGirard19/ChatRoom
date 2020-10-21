const net = require('net'),
  singleton = require('./Singleton'),
  clientHandler = require('./ClientsHandler'),
  opn = require("opn"),
  fs = require("fs");

class PeerData {
  constructor(IP, port) {
    this.IP = IP;
    this.port = port;
  }
  getAddress() {
    return this.IP + ':' + this.port;
  }
}

let ConnectToHost, ConnectToPort, maxNumPeers, versionNum, imageName;


let imageNdx = process.argv.findIndex((param) => param === '-q');
if(imageNdx !==-1){
  imageName = process.argv[imageNdx + 1];
}
else{
  imageName = null;
}

//Get host and port from arguments, if not given set to null
let addressNdx = process.argv.findIndex((param) => param === '-p');
if(addressNdx !== -1){
  [ConnectToHost, ConnectToPort] = process.argv[addressNdx + 1].split(':');
}
else {
  [ConnectToHost, ConnectToPort] = [null, null]
}

//set max peers from argument, if not given default to 2
let maxPeerNdx = process.argv.findIndex((param) => param === '-n');
if(maxPeerNdx !== -1){
  if(process.argv[maxPeerNdx + 1] >= 1){
    maxNumPeers = parseInt(process.argv[maxPeerNdx + 1]);
  }
  else{
    throw "Number of peers less than 1";
  }
}
else {
  maxNumPeers = 6;
}

//check version num, default to 3314 if not specified, error if something other than 3314
let versionNumNdx = process.argv.findIndex((param) => param === '-v');
if(versionNumNdx !== -1){
  if(process.argv[versionNumNdx + 1] == 3314){
    versionNum = 3314;
  }
  else{
    throw "Program does not support this version number";
  }
}
else{
  versionNum = 3314;
}

//initialize timestamp
//initialize handler
singleton.init();
clientHandler.init(maxNumPeers, "matt", versionNum);

//host server for this peer
let peer = net.createServer();

//image server
let imageServer = net.createServer();

//get directory
let dirPath = __dirname.split("/");
let workingDir = dirPath.pop();

//tracks the age of declined peers to remove oldest one;
let age = 0;

//holds the image port so that clients know where to send requets
let myImagePort, myImageHost;

//listen and automatically assign port
peer.listen(0, '127.0.0.1', () => {
  const myPort = peer.address().port;
  const myHost = peer.address().address;
  console.log('This peer address is ' + myHost + ':' + myPort + ' located at ' + workingDir);

  //connect to another peer if arguments called for it
  if (ConnectToPort && ConnectToHost) {
    const clientSocket = new net.Socket();
    clientHandler.addToPeerTable(ConnectToHost, parseInt(ConnectToPort), true);
    clientSocket.connect({port: ConnectToPort, host: ConnectToHost, localPort: myPort}, () => {
      console.log('Connected to peer: ' + ConnectToHost + ':' + ConnectToPort + ' at timestamp: ' + singleton.getTimestamp());
      let verBuffer = Buffer.alloc(3);
      verBuffer.writeInt16BE(versionNum);
      let reqBuffer = Buffer.alloc(1);
      //requesting image
      if(imageName != null){
        reqBuffer.writeInt8(0);
      }
      //just wants to connect, no image request
      else {
        reqBuffer.writeInt8(1);
      }
      let bufferMain = Buffer.concat([verBuffer, reqBuffer]);
      clientSocket.write(bufferMain);
    });

    clientSocket.on('data', (data) => {
      clientReceiveData(data, clientSocket, myPort);
    });

    clientSocket.on('close', () => {
      console.log('\nConnection ' + ConnectToHost + ':' + ConnectToPort + ' closed\n')
      clientHandler.removeFromPeerTable(ConnectToHost, ConnectToPort);
    });
  }
});

peer.on('connection', (sock) => {
  clientHandler.handleClientJoining(sock, myImagePort);
});


//create port to handle image requests
imageServer.listen(0, '127.0.0.1', () => {
  myImagePort = imageServer.address().port;
  myImageHost = imageServer.address().address;
  console.log("This peer image address is " + myImageHost + ":" + myImagePort);
});

imageServer.on("connection", (sock) => {
  console.log("Image server connected to " + sock.remoteAddress + ":" + sock.remotePort)
  clientHandler.handleImageRequest(sock);
});


function clientReceiveData(data, clientSocket, myPort){
  const messageType = data.slice(3, 4).readInt8();
  const numberOfPeers = data.slice(8, 12).readInt32BE();
  const imagePortReturned = data.slice(12, 16).readInt32BE();
  let returnedPeers = [];

  //add to peer table regradless, will remove if msgType = 2
  clientHandler.setPending(clientSocket.remoteAddress, clientSocket.remotePort, false);
  clientHandler.displayPeerTable();

  //need to update peers after we connect
  if (messageType === 1){
    console.log('Received ACK from ' + clientSocket.remoteAddress + ':' + clientSocket.remotePort);
    if(numberOfPeers > 0){
      console.log('which is peered with: ');
    }
  }
  else if (messageType === 2) {
    console.log('Join redirected, connecting to the peers below.');
    clientHandler.addToPeerDeclineTable(clientSocket.remoteAddress, clientSocket.remotePort, age++); //ensures we don't connect to host we already got rejected from
    clientSocket.destroy(); //removes from peer peerTable
  }

  //connect to image server
  if(imagePortReturned){
    connectToImagePort(imagePortReturned, myImagePort, imageName);
  }

  if (numberOfPeers > 0) {
    for(let i=0; i<numberOfPeers; i++){
      let beginSlice = i * 8 + 18;
      let peerPort = data.slice(beginSlice, beginSlice+2).readUInt16BE();
      let peerHost = data.slice(beginSlice+2, beginSlice+6).join('.');
      console.log("   " + peerHost + ":" + peerPort);
      returnedPeers.push(new PeerData(peerHost, peerPort));
    }

    for(let i=0; i<returnedPeers.length; i++){
      // (1) don't attempt to join peers already in your peer table, X
      // (2) don't attempt another join with peers you already have a pending join, 
      // (3) don't attempt to join the last maxpeers peers who have declined your earlier join attempt,
      // (4) if you try to join a peer at the same time it tries to join you, only one will successfully form a link.
      if(!clientHandler.inPeerTable(returnedPeers[i].IP, returnedPeers[i].port) && !clientHandler.inPeerDeclineTable(returnedPeers[i].IP, returnedPeers[i].port)){
          connectToNewClient(returnedPeers[i], myPort);
      }
    }
  }
}

function connectToImagePort(imagePort, myImagePort, imageName){
  const imageSocket = new net.Socket();
  imageSocket.connect({port: imagePort, host: '127.0.0.1', localPort: myImagePort}, () => {
    console.log('Connected to image port: 127.0.0.1' + ':' + imagePort + ' at timestamp: ' + singleton.getTimestamp());
      let verBuffer = Buffer.alloc(3);
      verBuffer.writeInt16BE(versionNum);
      let reqBuffer = Buffer.alloc(1);
      reqBuffer.writeInt8(1);
      let imageBuffer = Buffer.alloc(12, imageName);
      let bufferMain = Buffer.concat([verBuffer, reqBuffer, imageBuffer]);
      imageSocket.write(bufferMain);
  });
  imageSocket.on('data', (data) => {
    fs.writeFile('ImagesReceived/'+imageName, data, function(err){
      if(err){
          console.log("could not write file");
      }
      else{
          console.log("file created");
          opn('ImagesReceived/'+imageName);
      }
    });
    imageSocket.destroy();
  });
}

function connectToNewClient(connectClient, myPort){
  const newClientSocket = new net.Socket();
  clientHandler.addToPeerTable(connectClient.IP, connectClient.port, true);
  newClientSocket.connect({port: connectClient.port, host: connectClient.IP, localPort: myPort}, () => {
    console.log('Connected to peer: ' + connectClient.IP + ':' + connectClient.port + ' at timestamp: ' + singleton.getTimestamp());
      let verBuffer = Buffer.alloc(3);
      verBuffer.writeInt16BE(versionNum);
      let reqBuffer = Buffer.alloc(1);
      reqBuffer.writeInt8(1);
      let bufferMain = Buffer.concat([verBuffer, reqBuffer]);
      newClientSocket.write(bufferMain);
  });

  newClientSocket.on('data', (data) => {
    clientReceiveData(data, newClientSocket, myPort);
  });

  newClientSocket.on('close', () => {
    console.log('\nConnection ' + connectClient.IP + ":" + connectClient.port + ' closed\n');
    clientHandler.removeFromPeerTable(connectClient.IP, connectClient.port );
  });
}