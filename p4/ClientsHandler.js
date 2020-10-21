//create PeerData you can store IP and port together
const fs = require("fs");

class PeerData {
  constructor(IP, port, pending) {
    this.IP = IP;
    this.port = port;
    this.pending = pending;
  }
  getAddress() {
    return this.IP + ':' + this.port;
  }
}

class PeerDeclineData {
  constructor(IP, port, age){
    this.IP = IP;
    this.port = port;
    this.age = age;
  }
  getAddress() {
    return this.IP + ':' + this.port;
  }
}

  let peerTable = [];
  let peerDeclineTable = [];
  let imagePeerTable = [];
  let maxPeerCount;
  let sender;
  let versionNumber;
  let myImagePort;
  
  module.exports = {

    init: function (maxCount, s, versionNum) {
      maxPeerCount = maxCount;
      sender = s;
      versionNumber = versionNum;
    },

    handleImageRequest: function(sock){
      sock.on('data', (data) => {
        let imageName = data.slice(4,16).toString();
        imageName = imageName.split(".")[0];
        let picPath = "Images/" + imageName + ".jpg";
        fs.readFile(picPath, function(err, data) {
          if(err){
            console.log("Could not find image");
          }
          else{
            sock.write(data);
          }
        })
      })

      sock.on('close', (res) => {
        console.log("Image Socket Closed");
      })
    },

    setPending: function(IP, port, pending){
      for(let i=0; i<peerTable.length; i++){
        if (IP + ":" + port === peerTable[i].getAddress()){
          peerTable[i].pending = pending;
        }
      }
    },

    inPeerDeclineTable: function(IP, port){
      for(let i=0; i<peerDeclineTable.length; i++){
        if (IP + ":" + port === peerDeclineTable[i].getAddress()){
          return true;
        }
      }
      return false;
    },

    addToPeerDeclineTable: function(IP, port, age) {
      //if table full remove the oldest peer and replace
      let newPeer = new PeerDeclineData(IP, port, age);
      // if(peerDeclineTable.length === maxPeerCount){
      //   //find oldest peer
      //   let oldestPeer = peerDeclineTable[0];
      //   for(let i=0; i<peerDeclineTable.length; i++){
      //     //smaller the age the older
      //     if(peerDeclineTable[i].age < oldestPeer.age){
      //       oldestPeer = peerDeclineTable[i];
      //     }
      //   }
      //   //replace oldest peer with newest declined peer
      //   peerDeclineTable = peerDeclineTable.map((peer) => {
      //     if(peer.getAddress() === oldestPeer.IP + ':' + oldestPeer.port){
      //       peer = newPeer;
      //     }
      //     return peer;
      //   });
      // }
      // //otherwise just push to peerDeclineTable
      // else {
      //   peerDeclineTable.push(newPeer);
      // }
      peerDeclineTable.push(newPeer);
      this.displayDeclinePeerTable();
    },

    displayDeclinePeerTable: function(){
      console.log("\nPeer Decline Table")
      for(let i=0; i<peerDeclineTable.length; i++){
        console.log("Entry " + i + ":");
        console.log(peerDeclineTable[i]);
      }
      console.log()
    },

    displayPeerTable: function(){
      console.log("\n Peer Table")
      for(let i=0; i<peerTable.length; i++){
        console.log("Entry " + i + ":")
        console.log(peerTable[i]);
      }
      console.log();
    },

    inPeerTable: function(IP, port) {
      for(let i=0; i<peerTable.length; i++){
        if (IP + ":" + port === peerTable[i].getAddress()){
          return true;
        }
      }
      return false;
    },

    //used for adding peer when server accepts peers connection
    addToPeerTable: function(IP, port, pending) {
      peerTable.push(new PeerData(IP, port, pending));
      this.displayPeerTable();
    },

    //used for removing peer when server closes
    removeFromPeerTable: function(IP, port){
      console.log("Trying to remove " + IP + ":" + port);
      let peerClosed = peerTable.find((peer) => {
        return peer.getAddress() === (IP + ':' + port);
      });
      peerTable = peerTable.filter((peer) => {
        return !(peer.getAddress() == peerClosed.getAddress());
      });
      this.displayPeerTable();
    },

    handleClientJoining: function (sock, imagePort) {
      myImagePort = imagePort;
      let msgType;
      if(peerTable.length < maxPeerCount){
        msgType = 1;
      }
      else{
        msgType = 2;
      }
  
      let numOfPeers = peerTable.length;

      //add peer to table regardless of if its full, will remove using msg type
      //set pending to true until ACK received
      peerTable.push(new PeerData(sock.remoteAddress, sock.remotePort, true));
      this.displayPeerTable();
  
      sock.on('data', (data) => {
        let reqType = data.slice(3, 4).readInt8();
        peerTable = peerTable.map((peer) => {
          //find peer in peerTable
          if (peer.getAddress() === sock.remoteAddress + ':' + sock.remotePort) {
            peer.pending = false;
            //just connect
            if(msgType == 1 && reqType == 1){
              console.log('Connected from peer: ' + peer.getAddress());
              let packet = this.createPacket(
                versionNumber,
                msgType,
                sender,
                numOfPeers,
                false
              );
              sock.write(packet);
            }
            else if(msgType == 1 && reqType == 0){
              console.log('Connected from peer: ' + peer.getAddress());
              let packet = this.createPacket(
                versionNumber,
                msgType,
                sender,
                numOfPeers,
                true
              );
              sock.write(packet);
            }
            else {
              console.log('Peer Table full: ' + peer.getAddress() + " redirected");
              let packet = this.createPacket(
                versionNumber,
                msgType,
                sender,
                numOfPeers,
                false
              );
              sock.write(packet);
            }
          }
          return peer;
        })
      })
  
      // Handle disconnection
      sock.on('close', (res) => {
        //find peer that matches address clsoed
        let peerClosed = peerTable.find((peer) => {
          return peer.getAddress() === sock.remoteAddress + ':' + sock.remotePort;
        });
        console.log('CLOSED: ' + peerClosed.getAddress());
        peerTable = peerTable.filter((peer) => {
          return !(peer.getAddress() == peerClosed.getAddress());
        });
        this.displayPeerTable();
      })
    },
  
    createPacket: function (
      version,
      msgType,
      sender,
      numOfPeers,
      imageRequest,
    ) {
  
      let verBuffer = Buffer.alloc(3);
      let msgBuffer = Buffer.alloc(1);
      let senderBuffer = Buffer.alloc(4, sender.toString());
      let numPeersBuffer = Buffer.alloc(4);
      let imagePortBuffer = Buffer.alloc(4);
      verBuffer.writeInt16BE(version);
      msgBuffer.writeInt8(msgType);
      numPeersBuffer.writeInt32BE(numOfPeers);
      if(imageRequest){
        imagePortBuffer.writeInt32BE(myImagePort);
      }

      let bufferMain = Buffer.concat([verBuffer, msgBuffer, senderBuffer, numPeersBuffer, imagePortBuffer])
      
      //create buffers for all peers
      if (numOfPeers > 0) {
        for(let i=0; i<numOfPeers; i++){
          let reserveBuffer = Buffer.alloc(2);
          let portBuffer = Buffer.alloc(2);
          let IPBuffer = Buffer.from(
            peerTable[i].IP.split('.').map((str) => parseInt(str))
          );
          reserveBuffer.writeInt16BE(null);
          portBuffer.writeUInt16BE(peerTable[i].port);
          let peerBuffer = Buffer.concat([reserveBuffer, portBuffer, IPBuffer]);
          bufferMain = Buffer.concat([bufferMain, peerBuffer]);
        }
      }
      
      return bufferMain;
    }
  }

