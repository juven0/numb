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
  }

  async initialize() {
    try {
      // Initialiser le stockage
      await this.storage.init();

      // Vérifier si nous avons déjà un bloc genesis
      const lastHash = await this.storage.getLastBlockHash();
      if (!lastHash) {
        console.log("Creating genesis block");
        const genesisBlock = this.createGenesisBlock();
        await this.storage.saveBlock(genesisBlock);
      }

      // Démarrer le synchroniseur
      await this.synchronizer.start();
      console.log("Blockchain initialized successfully");
    } catch (error) {
      console.error("Error initializing blockchain:", error);
      throw error;
    }
  }

  createGenesisBlock() {
    return new BlockIteme(0, "0", null, Date.now(), [], []);
  }

  async getLasteBlock() {
    try {
      const lastHash = await this.storage.getLastBlockHash();
      if (!lastHash) return null;
      return await this.storage.getBlock(lastHash);
    } catch (error) {
      console.error("Error getting last block:", error);
      return null;
    }
  }

  async addBlock(newBlock) {
    try {
      // Vérifier si le bloc existe déjà
      const existingBlock = await this.storage.getBlock(newBlock.hash);
      if (existingBlock) {
        console.log("Block already exists:", newBlock.hash);
        return false;
      }

      // Vérifier le lien avec le bloc précédent
      const lastBlock = await this.getLasteBlock();
      if (lastBlock && newBlock.previousHash !== lastBlock.hash) {
        throw new Error("Invalid previous hash");
      }

      // Sauvegarder le bloc
      await this.storage.saveBlock(newBlock);
      console.log("Block added successfully:", newBlock.hash);
      return true;
    } catch (error) {
      console.error("Error adding block:", error);
      throw error;
    }
  }

  async getBlock(hash) {
    try {
      return await this.storage.getBlock(hash);
    } catch (error) {
      console.error("Error getting block:", error);
      return null;
    }
  }

  async getAllBlocks() {
    try {
      return await this.storage.getAllBlocks();
    } catch (error) {
      console.error("Error getting all blocks:", error);
      return [];
    }
  }

  async getBlocksAfter(hash) {
    try {
      const blocks = [];
      const allBlocks = await this.getAllBlocks();

      let foundStartBlock = false;
      for (const block of allBlocks) {
        if (hash === null || foundStartBlock) {
          blocks.push(block);
        } else if (block.hash === hash) {
          foundStartBlock = true;
        }
      }

      return blocks;
    } catch (error) {
      console.error("Error getting blocks after hash:", error);
      return [];
    }
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

  async isChainValid() {
    try {
      const blocks = await this.getAllBlocks();

      for (let i = 1; i < blocks.length; i++) {
        const currentBlock = blocks[i];
        const previousBlock = blocks[i - 1];

        if (currentBlock.hash !== currentBlock.calculateHash()) {
          console.error("Invalid hash at block:", i);
          return false;
        }

        if (currentBlock.previousHash !== previousBlock.hash) {
          console.error("Invalid previous hash at block:", i);
          return false;
        }
      }
      return true;
    } catch (error) {
      console.error("Error validating chain:", error);
      return false;
    }
  }

  async getUserFiles(userId) {
    try {
      console.log("Getting files for user:", userId);
      const blocks = await this.storage.getAllBlocks();

      const userBlocks = blocks.filter((block) => block.userId === userId);

      return userBlocks.map((block) => ({
        fileName: block.fileMetadata.name,
        fileHash: block.fileMetadata.hash,
        uploadTimestamp: block.timestamp,
        blockHash: block.hash,
        share: block.sharing,
        transaction: block.transactions,
      }));
    } catch (error) {
      console.error("Error getting user files:", error);
      throw error;
    }
  }

  async getUserFile(userId, fileHash) {
    try {
      const blocks = await this.storage.getAllBlocks();
      const block = blocks.find(
        (block) =>
          block.userId === userId && block.fileMetadata?.hash === fileHash
      );

      if (!block) return null;

      return {
        file: {
          name: block.fileMetadata.name,
          hash: block.fileMetadata.hash,
        },
        storage: {
          blockHash: block.hash,
          timestamp: block.timestamp,
        },
      };
    } catch (error) {
      console.error("Error getting user file:", error);
      throw error;
    }
  }
  async verifyFileOwnership(userId, fileHash) {
    try {
      const blocks = await this.storage.getAllBlocks();
      return blocks.some(
        (block) =>
          block.userId === userId && block.fileMetadata?.hash === fileHash
      );
    } catch (error) {
      console.error("Error verifying file ownership:", error);
      throw error;
    }
  }
  async updateBlock(hash, updatedBlock) {
    try {
      // Vérifier que le bloc existe
      const existingBlock = await this.getBlock(hash);
      if (!existingBlock) {
        throw new Error("Block not found");
      }

      // Conserver le hash original
      updatedBlock.hash = hash;

      // Sauvegarder les modifications
      console.log(hash, JSON.stringify(updatedBlock));
      await this.storage.db.put(hash, JSON.stringify(updatedBlock));

      return true;
    } catch (error) {
      console.error("Error updating block:", error);
      throw error;
    }
  }
}
export { BlockChain };
