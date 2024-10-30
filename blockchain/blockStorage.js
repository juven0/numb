import { Level } from "level";
import fs from "fs/promises";
import path from "path";

class BlockStorage {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.isInitialized = false;
  }

  async init() {
    try {
      // Créer le répertoire si nécessaire
      await fs.mkdir(this.dbPath, { recursive: true });

      // Initialiser la base de données
      this.db = new Level(this.dbPath, { valueEncoding: "json" });
      await this.db.open();
      this.isInitialized = true;

      console.log("Block storage initialized at:", this.dbPath);
    } catch (error) {
      console.error("Error initializing block storage:", error);
      throw error;
    }
  }

  async saveBlock(block) {
    try {
      if (!this.isInitialized) {
        throw new Error("Database not initialized");
      }

      if (!block || !block.hash) {
        throw new Error("Invalid block data");
      }

      // Sauvegarder le bloc
      await this.db.put(block.hash, block);

      // Vérifier si c'est le bloc avec l'index le plus élevé
      const currentLastHash = await this.getLastBlockHash();
      const currentLastBlock = currentLastHash
        ? await this.getBlock(currentLastHash)
        : null;

      if (!currentLastBlock || block.index > currentLastBlock.index) {
        await this.db.put("LAST_BLOCK_HASH", block.hash);
      }

      console.log(`Block saved: ${block.hash} (index: ${block.index})`);
      return true;
    } catch (error) {
      console.error("Error saving block:", error);
      throw error;
    }
  }

  async getBlock(hash) {
    try {
      if (!this.isInitialized) {
        throw new Error("Database not initialized");
      }

      if (!hash) {
        throw new Error("Hash is required");
      }

      return await this.db.get(hash);
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      console.error("Error getting block:", error);
      throw error;
    }
  }

  async getLastBlockHash() {
    try {
      if (!this.isInitialized) {
        throw new Error("Database not initialized");
      }

      return await this.db.get("LAST_BLOCK_HASH");
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      console.error("Error getting last block hash:", error);
      throw error;
    }
  }

  async getAllBlocks() {
    try {
      if (!this.isInitialized) {
        throw new Error("Database not initialized");
      }

      const blocks = [];
      const values = await this.db.values().all();

      for (const value of values) {
        if (value && value.hash && value.index !== undefined) {
          blocks.push(value);
        }
      }

      // Trier les blocs par index
      blocks.sort((a, b) => a.index - b.index);
      return blocks;
    } catch (error) {
      console.error("Error getting all blocks:", error);
      throw error;
    }
  }

  async getBlockByIndex(index) {
    try {
      if (!this.isInitialized) {
        throw new Error("Database not initialized");
      }

      const blocks = await this.getAllBlocks();
      return blocks.find((block) => block.index === index) || null;
    } catch (error) {
      console.error("Error getting block by index:", error);
      throw error;
    }
  }

  async hasBlock(hash) {
    try {
      if (!this.isInitialized) {
        throw new Error("Database not initialized");
      }

      await this.db.get(hash);
      return true;
    } catch (error) {
      if (error.notFound) {
        return false;
      }
      throw error;
    }
  }

  async getBlockCount() {
    try {
      if (!this.isInitialized) {
        throw new Error("Database not initialized");
      }

      const blocks = await this.getAllBlocks();
      return blocks.length;
    } catch (error) {
      console.error("Error getting block count:", error);
      throw error;
    }
  }

  async clear() {
    try {
      if (!this.isInitialized) {
        throw new Error("Database not initialized");
      }

      await this.db.clear();
      console.log("Database cleared");
    } catch (error) {
      console.error("Error clearing database:", error);
      throw error;
    }
  }

  async close() {
    try {
      if (this.isInitialized && this.db) {
        await this.db.close();
        this.isInitialized = false;
        console.log("Database closed");
      }
    } catch (error) {
      console.error("Error closing database:", error);
      throw error;
    }
  }

  // Méthodes utilitaires
  async _validateBlock(block) {
    if (!block || typeof block !== "object") return false;
    if (!block.hash || !block.index !== undefined) return false;
    return true;
  }

  async _ensureInitialized() {
    if (!this.isInitialized) {
      throw new Error("Database not initialized");
    }
  }
}

export { BlockStorage };
