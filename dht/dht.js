class  DHT {
    constructor(node) {
        this.node = node
        this.ownPeerId
        this.routingTalbe = []
        this.maxSize = 20
        this.storage = new Map()
    }

    async start(){
        await this.node.handle("/simpledht/store", this._handleStore.bind(this));
        console.log("SimpleDHT started");
    }

    async _handleStore({ stream }) {
        // const message = await stream.source.next();
        // console.log(message)
        // const { key, value } = JSON.parse(message.value.toString());
        // this.storage.set(key, value);
        // await stream.sink([Buffer.from("OK")]);


        const message = await this._readFromStream(stream);
        console.log("Received store request:", message);
        await stream.close();
    }

    async _readFromStream(stream) {
        const chunks = [];
        for await (const chunk of stream.source) {
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks).toString();
        try {
          return JSON.parse(data);
        } catch (err) {
          console.error("Error parsing stream data:", err);
          return null;
        }
      }

    async put(keyHash, data){
    const closestPeers = await this._findClosestPeers(keyHash);

    for (const peer of closestPeers) {
      try {
        const connection = await this.node.dial(peer.id);
        const stream = await connection.newStream("/simpledht/store");
        await stream.sink([Buffer.from(JSON.stringify({ key: keyHash.toString(), value:'qwerqer' }))]);
        const response = await stream.source.next();
        await stream.close();

      } catch (err) {
        console.error(`Failed to store on peer ${peer.toString()}:`, err);
      }
    }
    }

    async _findClosestPeers(keyHash) {
        const peers = await this.node.peerStore.all();
        return peers
      }
}


export {DHT}
