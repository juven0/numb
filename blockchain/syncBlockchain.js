import { BlockIteme } from "./block.js";

class BlockchainSynchronizer {
  constructor(blockchain, dht, node) {
    this.blockchain = blockchain;
    this.dht = dht;
    this.node = node;
  }

  async start() {
    await this.node.handle("/blockchain/sync", this._handleSync.bind(this));
    setInterval(() => this.syncWithPeers(), 60000);
  }

  async syncWithPeers() {
    const peers = await this.dht._findClosestPeers(this.node.peerId.toString());

    for (const peer of peers) {
      try {
        const connection = await this.node.dial(peer.id);
        const stream = await connection.newStream("/blockchain/sync");

        const latestBlock = await this.blockchain.getLasteBlock();
        await stream.sink([JSON.stringify({ latestHash: latestBlock.hash })]);

        // Receive peer's response
        const response = await this._readStreamData(stream);
        const { latestHash, needsUpdate } = JSON.parse(response);

        if (needsUpdate) {
          await this._requestMissingBlocks(stream, latestBlock.hash);
        } else if (latestHash !== latestBlock.hash) {
          // Peer needs to update their chain
          await this._sendMissingBlocks(stream, latestHash);
        }

        await stream.close();
      } catch (error) {
        console.error(`Failed to sync with peer ${peer.id.toString()}:`, error);
      }
    }
  }

  async _handleSync({ stream }) {
    const data = await this._readStreamData(stream);
    const { latestHash } = JSON.parse(data);

    const ourLatestBlock = await this.blockchain.getLasteBlock();

    if (latestHash === ourLatestBlock.hash) {
      await stream.sink([
        JSON.stringify({ latestHash: ourLatestBlock.hash, needsUpdate: false }),
      ]);
    } else {
      const theirBlock = await this.blockchain.storage.getBlock(latestHash);
      if (theirBlock && theirBlock.index > ourLatestBlock.index) {
        await stream.sink([
          JSON.stringify({
            latestHash: ourLatestBlock.hash,
            needsUpdate: true,
          }),
        ]);
        await this._requestMissingBlocks(stream, ourLatestBlock.hash);
      } else {
        await stream.sink([
          JSON.stringify({
            latestHash: ourLatestBlock.hash,
            needsUpdate: false,
          }),
        ]);
        await this._sendMissingBlocks(stream, latestHash);
      }
    }

    await stream.close();
  }

  async _requestMissingBlocks(stream, fromHash) {
    await stream.sink([
      JSON.stringify({ action: "getMissingBlocks", fromHash }),
    ]);

    while (true) {
      const data = await this._readStreamData(stream);
      const block = JSON.parse(data);

      if (block.hash === "END") break;

      const newBlock = new BlockIteme(
        block.index,
        block.previousHash,
        block.fileMetadata,
        block.timestamp,
        block.transactions,
        block.cids
      );

      await this.blockchain.addBlock(newBlock);
    }
  }

  async _sendMissingBlocks(stream, fromHash) {
    let currentHash = (await this.blockchain.getLasteBlock()).hash;

    while (currentHash !== fromHash) {
      const block = await this.blockchain.storage.getBlock(currentHash);
      await stream.sink([JSON.stringify(block)]);
      currentHash = block.previousHash;
    }

    await stream.sink([JSON.stringify({ hash: "END" })]);
  }

  async _readStreamData(stream) {
    let data = "";
    for await (const chunk of stream.source) {
      data += new TextDecoder().decode(chunk.subarray());
    }
    return data;
  }
}

export { BlockchainSynchronizer };
