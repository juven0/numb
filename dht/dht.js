class DHT {
  constructor(node) {
    this.node = node;
    this.ownPeerId;
    this.routingTalbe = [];
    this.maxSize = 20;
    this.storage = new Map();
  }

  async start() {
    await this.node.handle("/simpledht/store", this._handleStore.bind(this));
    await this.node.handle("/simpledht/get", this._handleGet.bind(this));
    console.log("SimpleDHT started");
  }

  async _handleStore({ stream }) {
    const message = await stream.source.next();
    const buffer = message.value.bufs[0]; // Get the first buffer (if there are more, you might need to handle them as well)
    const decodedData = buffer.toString("utf8"); // Convert buffer to string

    const { key, value } = JSON.parse(decodedData);
    this.storage.set(key, value);
    await stream.close();
  }

  async _handleGet({ stream }) {
    const message = await stream.source.next();
    const buffer = message.value.bufs[0]; // Get the first buffer (if there are more, you might need to handle them as well)
    const decodedData = buffer.toString("utf8");
    const value = this.storage.get(decodedData);
    await stream.sink([Buffer.from(JSON.stringify({ value }))]);
    await stream.close();
  }

  async put(keyHash, data) {
    const closestPeers = await this._findClosestPeers(keyHash);
    this.storage.set(keyHash.toString(), "qwerqer");
    for (const peer of closestPeers) {
      try {
        const connection = await this.node.dial(peer.id);
        const stream = await connection.newStream("/simpledht/store");
        await stream.sink([
          Buffer.from(
            JSON.stringify({ key: keyHash.toString(), value: data.value })
          ),
        ]);
        const response = await stream.source.next();
        await stream.close();
      } catch (err) {
        console.error(`Failed to store on peer ${peer.toString()}:`, err);
      }
    }
  }

  async get(key) {
    // const value = this.storage.get(key);
    // console.log(this.storage);
    // if (value) {
    //   return value;
    // }
    const closestPeers = await this._findClosestPeers(key);

    for (const peer of closestPeers) {
      try {
        const connection = await this.node.dial(peer.id);
        const stream = await connection.newStream("/simpledht/get");
        await stream.sink([Buffer.from(key)]);
        const response = await stream.source.next();
        const buffer = response.value.bufs[0]; // Get the first buffer (if there are more, you might need to handle them as well)
        const decodedData = buffer.toString("utf8");
        // const value = JSON.parse(response.value.toString());
        // if (value) {
        //   this.storage.set(keyHash, value);
        //   return value;
        // }
        await stream.close();
        return decodedData;
      } catch (err) {
        console.error(`Failed to get from peer ${peer.toString()}:`, err);
      }
    }

    return null;
  }

  async _findClosestPeers(keyHash) {
    const peers = await this.node.peerStore.all();
    return peers;
  }
}

export { DHT };
