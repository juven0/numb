import { BlockIteme } from "./block.js";

class BlockChain {
  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.fileMetadataMap = new Map();
  }

  createGenesisBlock() {
    return new BlockIteme(0, "0", Date.now(), [], []);
  }

  getLasteBlock() {
    return this.chain[this.chain.length - 1];
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
