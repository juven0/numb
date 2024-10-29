import { Level } from "level";
import fs from "fs/promises";
import path from "path";

class BlockStorage {
  constructor(storageDir = "./blockstore") {
    this.storageDir = storageDir;
    this.db = new Level(path.join(storageDir, "blocks.db"), {
      valueEncoding: "json",
    });
    this.blockDir = path.join(storageDir, "blocks");
    this.init();
  }

  async init() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.mkdir(this.blockDir, { recursive: true });

      await this.db.open();
      console.log("Block storage initialized");
    } catch (error) {
      console.error("Error initializing block storage:", error);
      throw error;
    }
  }

  async storeBlock(cid, data) {
    try {
      const blockPath = this._getBlockPath(cid);

      await this.db.put(cid.toString(), {
        cid: cid.toString(),
        path: blockPath,
        size: data.length,
        timestamp: Date.now(),
      });

      await fs.writeFile(blockPath, Buffer.from(data));

      return true;
    } catch (error) {
      console.error("Error storing block:", error);
      throw error;
    }
  }

  async getBlock(cid) {
    try {
      const metadata = await this.db.get(cid.toString());

      const data = await fs.readFile(metadata.path);

      return data;
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      console.error("Error getting block:", error);
      throw error;
    }
  }

  async hasBlock(cid) {
    try {
      await this.db.get(cid.toString());
      return true;
    } catch (error) {
      if (error.notFound) {
        return false;
      }
      throw error;
    }
  }

  async deleteBlock(cid) {
    try {
      const metadata = await this.db.get(cid.toString());
      await fs.unlink(metadata.path);
      await this.db.del(cid.toString());
      return true;
    } catch (error) {
      console.error("Error deleting block:", error);
      throw error;
    }
  }

  _getBlockPath(cid) {
    const cidStr = cid.toString();
    const prefix = cidStr.slice(0, 4);
    const subdir = path.join(this.blockDir, prefix);
    fs.mkdir(subdir, { recursive: true });
    return path.join(subdir, cidStr);
  }

  async listBlocks() {
    const blocks = [];
    for await (const [key, value] of this.db.iterator()) {
      blocks.push(value);
    }
    return blocks;
  }

  async close() {
    await this.db.close();
  }
}

export { BlockStorage };
