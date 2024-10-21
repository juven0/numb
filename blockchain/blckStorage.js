import { Level } from "level";

class BlockStorage {
  constructor(strorePath) {
    this.db = new Level(strorePath, { valueEncoding: "json" });
  }

  async saveBlock(block) {
    await this.db.put(block.hash, block);
  }

  async getBlock(hash) {
    try {
      return await this.db.get(hash);
    } catch (error) {
      return null;
    }
  }

  async getLastBlockHash() {
    let LastBlockHash = null;
    for (const [key, _] of this.db.iterator({ reverse, limit: 1 })) {
      LastBlockHash = key;
    }
    return key;
  }
  async *getAllBlocks() {
    for await (const [hash, value] of this.db.iterator()) {
      yield value;
    }
  }
}

export { BlockStorage };
