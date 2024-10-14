import { Block } from "./block";

class BlockChain {
  constructeure() {}

  createGenesisBlock() {
    return new Block(0, "0", Date.now(), [], []);
  }

  getLasteBlock() {
    return this.chain[this.chain.length - 1];
  }

  addBlock(newBlock) {
    this.chain.push(newBlock);
  }
}
