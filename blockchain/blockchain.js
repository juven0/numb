import { BlockIteme } from "./block.js";
import { BlockStorage } from "./blockStorage.js";
import { BlockchainSynchronizer } from "./syncBlockchain.js";

class BlockChain {
  constructor(dbPath, dht, node) {
    this.storage = new BlockStorage(dbPath);
    this.fileMetadataMap = new Map();
    this.dht = dht;
    this.node = node;
    this.synchronizer = new BlockchainSynchronizer(this, dht, this.node);
    this.initialize();
  }

  async initialize() {
    const lastHash = await this.storage.getLastBlockHash();
    if (!lastHash) {
      const genesisBlock = this.createGenesisBlock();
      await this.storage.saveBlock(genesisBlock);
    }
    await this.synchronizer.start();
  }

  createGenesisBlock() {
    return new BlockIteme(0, "0", Date.now(), [], []);
  }

  getLasteBlock() {
    //return this.storage.
  }

  addBlock(newBlock) {
    this.chain.push(newBlock);
  }

  getFileMetadata(cid) {
    return this.fileMetadataMap.get(cid);
  }

  addFileMetadata(fileMetadata) {
    this.fileMetadataMap.set(fileMetadata.cid, fileMetadata);
  }

  updateFileMetadata(cid, updates) {
    const metadata = this.fileMetadataMap.get(cid);
    if (metadata) {
      Object.assign(metadata, updates);
      metadata.updateLastModified();
    }
  }

  isChainValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      if (currentBlock.hash !== currentBlock.calculateHash()) {
        return false;
      }

      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }
    }
    return true;
  }
}

export { BlockChain };
