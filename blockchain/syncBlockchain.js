import { BlockIteme } from "./block.js";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";

class BlockchainSynchronizer {
  constructor(blockchain, dht, node) {
    this.blockchain = blockchain;
    this.dht = dht;
    this.node = node;
  }

  async start() {
    await this.node.handle("/blockchain/sync", this._handleSync.bind(this));
    setInterval(() => this.syncWithPeers(), 30000);
  }

  async syncWithPeers() {
    const peers = await this.dht._findClosestPeers(this.node.peerId.toString());
    console.log(
      "Found peers:",
      peers.map((p) => p.id.toString())
    );

    for (const peer of peers) {
      try {
        console.log("Attempting to sync with peer:", peer.id.toString());
        const connection = await this.node.dial(peer.id);
        const stream = await connection.newStream("/blockchain/sync");

        const latestBlock = await this.blockchain.getLasteBlock();
        console.log(
          "Latest block:",
          latestBlock ? `Hash: ${latestBlock.hash}` : "No blocks yet"
        );

        const syncData = {
          latestHash: latestBlock ? latestBlock.hash : null,
          height: latestBlock ? latestBlock.index : -1,
        };

        await stream.sink([uint8ArrayFromString(JSON.stringify(syncData))]);
        console.log("Sent sync data:", syncData);

        const response = await this._readStreamData(stream);
        if (!response) {
          console.log("No response from peer");
          await stream.close();
          continue;
        }

        const peerData = JSON.parse(response);
        console.log("Received peer data:", peerData);

        if (!latestBlock && peerData.height >= 0) {
          console.log("Requesting initial chain from peer");
          await this._requestFullChain(stream);
        } else if (peerData.height > latestBlock.index) {
          console.log("Requesting missing blocks from peer");
          await this._requestMissingBlocks(stream, latestBlock.hash);
        } else if (peerData.height < latestBlock.index) {
          console.log("Sending missing blocks to peer");
          await this._sendMissingBlocks(stream, peerData.latestHash);
        } else {
          console.log("Chains are in sync");
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
    console.log(JSON.parse(data));

    const ourLatestBlock = await this.blockchain.getLasteBlock();

    if (latestHash === ourLatestBlock?.hash) {
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

  // --------------------------------

  async _requestFullChain(stream) {
    try {
      await stream.sink([
        uint8ArrayFromString(
          JSON.stringify({
            action: "getFullChain",
          })
        ),
      ]);

      const chainData = await this._readStreamData(stream);
      if (!chainData) return;

      const blocks = JSON.parse(chainData);
      for (const blockData of blocks) {
        await this.blockchain.addBlock(blockData);
      }

      console.log(`Received and added ${blocks.length} blocks`);
    } catch (error) {
      console.error("Error requesting full chain:", error);
    }
  }

  async _requestMissingBlocks(stream, fromHash) {
    try {
      await stream.sink([
        uint8ArrayFromString(
          JSON.stringify({
            action: "getMissingBlocks",
            fromHash,
          })
        ),
      ]);

      while (true) {
        const blockData = await this._readStreamData(stream);
        if (!blockData) break;

        const block = JSON.parse(blockData);
        if (block.hash === "END") break;

        await this.blockchain.addBlock(block);
        console.log(`Added block ${block.index}`);
      }
    } catch (error) {
      console.error("Error requesting missing blocks:", error);
    }
  }

  async _sendMissingBlocks(stream, fromHash) {
    try {
      const blocks = await this.blockchain.getBlocksAfter(fromHash);
      for (const block of blocks) {
        await stream.sink([uint8ArrayFromString(JSON.stringify(block))]);
      }
      await stream.sink([
        uint8ArrayFromString(JSON.stringify({ hash: "END" })),
      ]);
    } catch (error) {
      console.error("Error sending missing blocks:", error);
    }
  }

  async _readStreamData(stream) {
    try {
      const message = await stream.source.next();
      if (message.done) return null;
      return uint8ArrayToString(message.value.subarray());
    } catch (error) {
      console.error("Error reading stream:", error);
      return null;
    }
  }
}

export { BlockchainSynchronizer };
